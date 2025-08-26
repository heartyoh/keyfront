import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withValidation, CommonSchemas } from '@/lib/validation';
import { generateTraceId } from '@/lib/tracing';

// Test validation schema
const TestInputSchema = z.object({
  name: z.string().min(2).max(50),
  email: CommonSchemas.email,
  age: z.number().int().min(0).max(150),
  bio: z.string().max(1000).optional(),
  tags: z.array(z.string().min(1).max(20)).max(5).optional(),
  website: z.string().url().optional(),
  isActive: z.boolean().default(true),
  metadata: z.object({
    source: z.string().optional(),
    category: z.enum(['personal', 'business', 'other']).default('other'),
  }).optional(),
});

type TestInput = z.infer<typeof TestInputSchema>;

async function handler(
  request: NextRequest,
  validatedData: TestInput
): Promise<NextResponse> {
  const traceId = generateTraceId();

  try {
    // Simulate some processing
    const processed = {
      ...validatedData,
      processedAt: new Date().toISOString(),
      sanitized: true,
    };

    return NextResponse.json({
      success: true,
      data: processed,
      message: 'Input validation and sanitization successful',
      traceId,
    });
  } catch (error) {
    console.error('Validation test handler error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'HANDLER_ERROR',
          message: 'Processing error after validation',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

// Apply validation middleware
export const POST = withValidation(TestInputSchema, {
  sanitize: true,
  validateQuery: false,
  validateBody: true,
})(handler);

// GET endpoint for validation info
export async function GET(request: NextRequest) {
  const traceId = generateTraceId();

  return NextResponse.json({
    success: true,
    data: {
      schema: {
        name: 'string (2-50 chars)',
        email: 'valid email format',
        age: 'integer (0-150)',
        bio: 'string (max 1000 chars, optional)',
        tags: 'array of strings (max 5 tags, each 1-20 chars, optional)',
        website: 'valid URL (optional)',
        isActive: 'boolean (default: true)',
        metadata: {
          source: 'string (optional)',
          category: 'enum: personal|business|other (default: other)',
        },
      },
      examples: {
        valid: {
          name: 'John Doe',
          email: 'john@example.com',
          age: 30,
          bio: 'Software developer with 5 years experience',
          tags: ['developer', 'javascript', 'react'],
          website: 'https://johndoe.com',
          isActive: true,
          metadata: {
            source: 'registration',
            category: 'business',
          },
        },
        malicious: {
          name: '<script>alert("xss")</script>John',
          email: 'john@evil.com\'; DROP TABLE users; --',
          age: -999999,
          bio: 'Normal bio <img src=x onerror=alert(1)>',
          tags: Array(100).fill('spam'), // Too many tags
          website: 'javascript:alert("xss")',
          metadata: {
            source: '<iframe src="evil.com"></iframe>',
            category: 'personal',
          },
        },
      },
      sanitizationFeatures: [
        'HTML tag sanitization with DOMPurify',
        'SQL injection pattern filtering',
        'XSS script blocking',
        'Length limits enforcement',
        'Array/object size limits',
        'Type coercion and validation',
      ],
    },
    traceId,
  });
}