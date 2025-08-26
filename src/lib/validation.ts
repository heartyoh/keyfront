import { NextRequest, NextResponse } from 'next/server';
import { z, ZodSchema, ZodError } from 'zod';
import { generateTraceId } from './tracing';
import { globalSecurityScanner, SecurityThreat } from './security-scanner';
import DOMPurify from 'isomorphic-dompurify';

export interface ValidationConfig {
  sanitizeHtml?: boolean;
  stripTags?: boolean;
  maxStringLength?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
  allowedFileTypes?: string[];
  maxFileSize?: number; // in bytes
  customSanitizers?: Record<string, (value: any) => any>;
  enableSecurityScanning?: boolean;
  blockOnSecurityThreats?: boolean;
}

export interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
  sanitized?: boolean;
  securityThreats?: SecurityThreat[];
  blocked?: boolean;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
  value?: any;
}

export class InputValidator {
  private config: ValidationConfig;

  constructor(config: ValidationConfig = {}) {
    this.config = {
      sanitizeHtml: true,
      stripTags: false,
      maxStringLength: 10000,
      maxArrayLength: 1000,
      maxObjectKeys: 100,
      allowedFileTypes: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
      maxFileSize: 10 * 1024 * 1024, // 10MB
      customSanitizers: {},
      enableSecurityScanning: true,
      blockOnSecurityThreats: process.env.NODE_ENV === 'production',
      ...config,
    };
  }

  /**
   * Sanitize HTML content using DOMPurify
   */
  private sanitizeHtml(html: string): string {
    if (!this.config.sanitizeHtml) return html;
    
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'ol', 'ul', 'li', 'a', 'span'],
      ALLOWED_ATTR: ['href', 'title', 'class'],
      ALLOW_DATA_ATTR: false,
    });
  }

  /**
   * Strip HTML tags completely
   */
  private stripHtmlTags(html: string): string {
    return html.replace(/<[^>]*>/g, '');
  }

  /**
   * Sanitize a single value based on its type
   */
  private sanitizeValue(value: any, path: string = ''): any {
    if (value === null || value === undefined) {
      return value;
    }

    // Custom sanitizer
    if (this.config.customSanitizers?.[path]) {
      return this.config.customSanitizers[path](value);
    }

    if (typeof value === 'string') {
      let sanitized = value;

      // Trim whitespace
      sanitized = sanitized.trim();

      // Length limit
      if (this.config.maxStringLength && sanitized.length > this.config.maxStringLength) {
        sanitized = sanitized.substring(0, this.config.maxStringLength);
      }

      // HTML sanitization
      if (this.config.stripTags) {
        sanitized = this.stripHtmlTags(sanitized);
      } else if (this.config.sanitizeHtml) {
        sanitized = this.sanitizeHtml(sanitized);
      }

      // SQL injection patterns (basic)
      sanitized = sanitized.replace(/(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi, '[FILTERED]');

      // XSS patterns (basic - DOMPurify handles most)
      sanitized = sanitized.replace(/javascript:/gi, '[FILTERED]:');
      sanitized = sanitized.replace(/on\w+\s*=/gi, '[FILTERED]=');

      return sanitized;
    }

    if (Array.isArray(value)) {
      // Array length limit
      const limitedArray = this.config.maxArrayLength 
        ? value.slice(0, this.config.maxArrayLength)
        : value;

      return limitedArray.map((item, index) => 
        this.sanitizeValue(item, `${path}[${index}]`)
      );
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      
      // Object keys limit
      const limitedKeys = this.config.maxObjectKeys
        ? keys.slice(0, this.config.maxObjectKeys)
        : keys;

      const sanitized: any = {};
      for (const key of limitedKeys) {
        const sanitizedKey = typeof key === 'string' ? this.sanitizeValue(key, path) : key;
        sanitized[sanitizedKey] = this.sanitizeValue(
          value[key], 
          path ? `${path}.${key}` : key
        );
      }
      return sanitized;
    }

    return value;
  }

  /**
   * Validate data against Zod schema
   */
  async validate<T>(
    data: unknown,
    schema: ZodSchema<T>,
    sanitize: boolean = true,
    traceId?: string
  ): Promise<ValidationResult<T>> {
    try {
      // Security scanning first
      let securityThreats: SecurityThreat[] = [];
      let processedData = data;

      if (this.config.enableSecurityScanning) {
        const scanResults = await globalSecurityScanner.scanBatch(
          typeof data === 'object' && data !== null ? data as any : { input: data },
          traceId
        );

        // Collect all threats
        securityThreats = Object.values(scanResults).flatMap(result => result.threats);

        // Check if we should block
        if (this.config.blockOnSecurityThreats) {
          const shouldBlock = Object.values(scanResults).some(result => result.blocked);
          if (shouldBlock) {
            return {
              success: false,
              errors: [{
                field: 'security',
                message: 'Input blocked due to security threats',
                code: 'SECURITY_THREAT_BLOCKED',
              }],
              securityThreats,
              blocked: true,
              sanitized: sanitize,
            };
          }
        }

        // Use sanitized data if available
        const sanitizedResults = Object.values(scanResults).find(result => result.sanitized);
        if (sanitizedResults?.sanitized) {
          processedData = typeof data === 'object' && data !== null ? sanitizedResults.sanitized : sanitizedResults.sanitized.input;
        }
      }

      // Sanitize input if requested
      const inputData = sanitize ? this.sanitizeValue(processedData) : processedData;

      // Validate with Zod
      const result = schema.safeParse(inputData);

      if (result.success) {
        return {
          success: true,
          data: result.data,
          sanitized: sanitize,
          securityThreats: securityThreats.length > 0 ? securityThreats : undefined,
          blocked: false,
        };
      } else {
        const errors = this.formatZodErrors(result.error);
        return {
          success: false,
          errors,
          sanitized: sanitize,
          securityThreats: securityThreats.length > 0 ? securityThreats : undefined,
        };
      }
    } catch (error) {
      console.error('Validation error:', error);
      return {
        success: false,
        errors: [{
          field: 'root',
          message: 'Validation processing error',
          code: 'VALIDATION_ERROR',
        }],
        sanitized: sanitize,
      };
    }
  }

  /**
   * Format Zod errors into our error format
   */
  private formatZodErrors(zodError: ZodError): ValidationError[] {
    return zodError.errors.map(err => ({
      field: err.path.join('.') || 'root',
      message: err.message,
      code: err.code,
      value: err.code !== 'invalid_type' ? undefined : err.received,
    }));
  }

  /**
   * Validate file uploads
   */
  validateFile(file: File): ValidationResult {
    const errors: ValidationError[] = [];

    // File type validation
    if (this.config.allowedFileTypes && 
        !this.config.allowedFileTypes.includes(file.type)) {
      errors.push({
        field: 'type',
        message: `File type ${file.type} not allowed`,
        code: 'INVALID_FILE_TYPE',
        value: file.type,
      });
    }

    // File size validation
    if (this.config.maxFileSize && file.size > this.config.maxFileSize) {
      errors.push({
        field: 'size',
        message: `File size ${file.size} exceeds limit ${this.config.maxFileSize}`,
        code: 'FILE_TOO_LARGE',
        value: file.size,
      });
    }

    // File name validation
    const sanitizedName = this.sanitizeValue(file.name);
    if (sanitizedName !== file.name) {
      errors.push({
        field: 'name',
        message: 'File name contains invalid characters',
        code: 'INVALID_FILE_NAME',
        value: file.name,
      });
    }

    return {
      success: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      data: errors.length === 0 ? {
        name: sanitizedName,
        type: file.type,
        size: file.size,
      } : undefined,
    };
  }
}

/**
 * Common validation schemas
 */
export const CommonSchemas = {
  // User input schemas
  userId: z.string().uuid('Invalid user ID format'),
  tenantId: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid tenant ID format'),
  email: z.string().email('Invalid email format').max(255),
  password: z.string().min(8).max(128).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    'Password must contain uppercase, lowercase, number, and special character'
  ),

  // API input schemas
  pagination: z.object({
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(20),
    sort: z.string().optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
  }),

  // Content schemas
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  content: z.string().max(50000).optional(),
  tags: z.array(z.string().min(1).max(50)).max(10).optional(),

  // Security schemas
  ipAddress: z.string().ip('Invalid IP address'),
  userAgent: z.string().max(500),
  referer: z.string().url().optional(),

  // File upload schemas
  fileMetadata: z.object({
    name: z.string().min(1).max(255),
    type: z.string().min(1).max(100),
    size: z.number().int().min(0).max(100 * 1024 * 1024), // 100MB
  }),
};

/**
 * Request validation middleware
 */
export function withValidation<T>(
  schema: ZodSchema<T>,
  options: {
    sanitize?: boolean;
    validateQuery?: boolean;
    validateBody?: boolean;
    config?: ValidationConfig;
  } = {}
) {
  const validator = new InputValidator(options.config);
  
  return (
    handler: (request: NextRequest, validatedData: T) => Promise<NextResponse>
  ) => {
    return async (request: NextRequest): Promise<NextResponse> => {
      const traceId = generateTraceId();

      try {
        let dataToValidate: any = {};

        // Extract query parameters
        if (options.validateQuery !== false) {
          const searchParams = request.nextUrl.searchParams;
          const queryData: any = {};
          searchParams.forEach((value, key) => {
            queryData[key] = value;
          });
          dataToValidate = { ...dataToValidate, ...queryData };
        }

        // Extract request body
        if (options.validateBody !== false && 
            ['POST', 'PUT', 'PATCH'].includes(request.method)) {
          try {
            const contentType = request.headers.get('content-type') || '';
            
            if (contentType.includes('application/json')) {
              const body = await request.json();
              dataToValidate = { ...dataToValidate, ...body };
            } else if (contentType.includes('application/x-www-form-urlencoded')) {
              const formData = await request.formData();
              const formObject: any = {};
              formData.forEach((value, key) => {
                formObject[key] = value;
              });
              dataToValidate = { ...dataToValidate, ...formObject };
            }
          } catch (error) {
            return NextResponse.json(
              {
                success: false,
                error: {
                  code: 'INVALID_REQUEST_BODY',
                  message: 'Failed to parse request body',
                  traceId,
                },
              },
              { status: 400 }
            );
          }
        }

        // Validate the data
        const validation = await validator.validate(
          dataToValidate,
          schema,
          options.sanitize !== false,
          traceId
        );

        if (!validation.success) {
          const statusCode = validation.blocked ? 403 : 400;
          const errorCode = validation.blocked ? 'SECURITY_THREAT_BLOCKED' : 'VALIDATION_FAILED';
          
          return NextResponse.json(
            {
              success: false,
              error: {
                code: errorCode,
                message: validation.blocked ? 'Input blocked due to security threats' : 'Input validation failed',
                details: validation.errors,
                securityThreats: validation.securityThreats,
                traceId,
              },
            },
            { status: statusCode }
          );
        }

        // Log security threats if present but not blocking
        if (validation.securityThreats && validation.securityThreats.length > 0) {
          console.warn(`Security threats detected but not blocking (traceId: ${traceId}):`, 
            validation.securityThreats);
        }

        // Call handler with validated data
        return await handler(request, validation.data!);
      } catch (error) {
        console.error('Validation middleware error:', error);
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_MIDDLEWARE_ERROR',
              message: 'Validation processing error',
              traceId,
            },
          },
          { 
            status: 500,
            headers: {
              'x-keyfront-trace-id': traceId,
            }
          }
        );
      }
    };
  };
}

// Global validator instance
export const globalValidator = new InputValidator();

// Export for convenience
export { InputValidator as Validator };