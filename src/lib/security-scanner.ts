import { generateTraceId } from './tracing';
import { auditEvents } from './audit';

export interface SecurityThreat {
  type: 'sql_injection' | 'xss' | 'path_traversal' | 'command_injection' | 'ldap_injection' | 'nosql_injection';
  severity: 'low' | 'medium' | 'high' | 'critical';
  pattern: string;
  matched: string;
  field?: string;
  confidence: number; // 0-1
  description: string;
}

export interface ScanResult {
  safe: boolean;
  threats: SecurityThreat[];
  sanitized?: any;
  blocked?: boolean;
}

export interface ScannerConfig {
  enableBlocking: boolean;
  logThreats: boolean;
  sanitizeContent: boolean;
  strictMode: boolean;
  customPatterns?: { [key: string]: RegExp[] };
}

export class SecurityScanner {
  private config: ScannerConfig;

  // SQL Injection patterns
  private sqlPatterns: { pattern: RegExp; severity: SecurityThreat['severity']; description: string }[] = [
    {
      pattern: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi,
      severity: 'high',
      description: 'SQL keyword detected'
    },
    {
      pattern: /(\bOR\b\s*['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/gi,
      severity: 'critical',
      description: 'SQL tautology injection'
    },
    {
      pattern: /(['"]\s*;\s*--)/gi,
      severity: 'critical',
      description: 'SQL comment injection'
    },
    {
      pattern: /(\bUNION\b.*\bSELECT\b)/gi,
      severity: 'critical',
      description: 'SQL UNION injection'
    },
    {
      pattern: /(\/\*.*\*\/)/gi,
      severity: 'medium',
      description: 'SQL comment blocks'
    },
    {
      pattern: /(\'\s*\|\|\s*\')/gi,
      severity: 'high',
      description: 'SQL concatenation injection'
    },
    {
      pattern: /(\bxp_cmdshell\b)/gi,
      severity: 'critical',
      description: 'SQL Server command execution'
    }
  ];

  // XSS patterns
  private xssPatterns: { pattern: RegExp; severity: SecurityThreat['severity']; description: string }[] = [
    {
      pattern: /<script[^>]*>[\s\S]*?<\/script>/gi,
      severity: 'critical',
      description: 'Script tag injection'
    },
    {
      pattern: /javascript:/gi,
      severity: 'high',
      description: 'JavaScript URL protocol'
    },
    {
      pattern: /on\w+\s*=\s*["'][^"']*["']/gi,
      severity: 'high',
      description: 'HTML event handler injection'
    },
    {
      pattern: /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
      severity: 'high',
      description: 'Iframe injection'
    },
    {
      pattern: /<object[^>]*>[\s\S]*?<\/object>/gi,
      severity: 'high',
      description: 'Object tag injection'
    },
    {
      pattern: /<embed[^>]*>/gi,
      severity: 'medium',
      description: 'Embed tag injection'
    },
    {
      pattern: /<link[^>]*>/gi,
      severity: 'medium',
      description: 'Link tag injection'
    },
    {
      pattern: /<meta[^>]*>/gi,
      severity: 'medium',
      description: 'Meta tag injection'
    },
    {
      pattern: /eval\s*\(/gi,
      severity: 'critical',
      description: 'JavaScript eval() function'
    },
    {
      pattern: /expression\s*\(/gi,
      severity: 'high',
      description: 'CSS expression injection'
    }
  ];

  // Path traversal patterns
  private pathTraversalPatterns: { pattern: RegExp; severity: SecurityThreat['severity']; description: string }[] = [
    {
      pattern: /(\.\.[\/\\])+/g,
      severity: 'high',
      description: 'Directory traversal attempt'
    },
    {
      pattern: /(\/etc\/passwd|\/etc\/shadow)/gi,
      severity: 'critical',
      description: 'Unix system file access'
    },
    {
      pattern: /(\\windows\\system32)/gi,
      severity: 'critical',
      description: 'Windows system file access'
    },
    {
      pattern: /%2e%2e%2f/gi,
      severity: 'high',
      description: 'URL encoded directory traversal'
    }
  ];

  // Command injection patterns
  private commandInjectionPatterns: { pattern: RegExp; severity: SecurityThreat['severity']; description: string }[] = [
    {
      pattern: /(\b(ls|cat|wget|curl|nc|netcat|sh|bash|cmd|powershell)\b)/gi,
      severity: 'critical',
      description: 'System command detected'
    },
    {
      pattern: /[;&|`$(){}]/g,
      severity: 'high',
      description: 'Command injection metacharacters'
    }
  ];

  // NoSQL injection patterns
  private nosqlPatterns: { pattern: RegExp; severity: SecurityThreat['severity']; description: string }[] = [
    {
      pattern: /\$where/gi,
      severity: 'high',
      description: 'MongoDB $where injection'
    },
    {
      pattern: /\$ne/gi,
      severity: 'medium',
      description: 'MongoDB $ne operator'
    },
    {
      pattern: /\$gt/gi,
      severity: 'medium',
      description: 'MongoDB $gt operator'
    },
    {
      pattern: /\$regex/gi,
      severity: 'medium',
      description: 'MongoDB $regex operator'
    }
  ];

  // LDAP injection patterns
  private ldapPatterns: { pattern: RegExp; severity: SecurityThreat['severity']; description: string }[] = [
    {
      pattern: /[()=*!&|]/g,
      severity: 'medium',
      description: 'LDAP filter metacharacters'
    },
    {
      pattern: /\*\)/gi,
      severity: 'high',
      description: 'LDAP wildcard injection'
    }
  ];

  constructor(config: Partial<ScannerConfig> = {}) {
    this.config = {
      enableBlocking: true,
      logThreats: true,
      sanitizeContent: true,
      strictMode: process.env.NODE_ENV === 'production',
      ...config,
    };
  }

  /**
   * Scan input for security threats
   */
  async scanInput(
    input: any,
    field: string = 'unknown',
    traceId?: string
  ): Promise<ScanResult> {
    if (!traceId) {
      traceId = generateTraceId();
    }

    const threats: SecurityThreat[] = [];

    try {
      // Convert input to string for scanning
      const inputString = this.convertToString(input);
      if (!inputString) {
        return { safe: true, threats: [] };
      }

      // Run all security scans
      threats.push(...this.scanSqlInjection(inputString, field));
      threats.push(...this.scanXss(inputString, field));
      threats.push(...this.scanPathTraversal(inputString, field));
      threats.push(...this.scanCommandInjection(inputString, field));
      threats.push(...this.scanNosqlInjection(inputString, field));
      threats.push(...this.scanLdapInjection(inputString, field));

      // Run custom pattern scans
      if (this.config.customPatterns) {
        threats.push(...this.scanCustomPatterns(inputString, field));
      }

      // Determine if input should be blocked
      const highSeverityThreats = threats.filter(t => 
        ['high', 'critical'].includes(t.severity)
      );
      const shouldBlock = this.config.enableBlocking && highSeverityThreats.length > 0;

      // Log threats if enabled
      if (this.config.logThreats && threats.length > 0) {
        await this.logThreats(threats, field, inputString, traceId);
      }

      // Sanitize content if requested
      let sanitized;
      if (this.config.sanitizeContent && threats.length > 0) {
        sanitized = this.sanitizeInput(input, threats);
      }

      return {
        safe: threats.length === 0,
        threats,
        sanitized,
        blocked: shouldBlock,
      };
    } catch (error) {
      console.error('Security scanning error:', error);
      return {
        safe: false,
        threats: [{
          type: 'xss',
          severity: 'medium',
          pattern: 'scanner_error',
          matched: 'Error during scanning',
          field,
          confidence: 0.5,
          description: 'Security scanner encountered an error',
        }],
        blocked: this.config.strictMode,
      };
    }
  }

  private convertToString(input: any): string {
    if (typeof input === 'string') {
      return input;
    }
    if (typeof input === 'object') {
      try {
        return JSON.stringify(input);
      } catch {
        return String(input);
      }
    }
    return String(input);
  }

  private scanSqlInjection(input: string, field: string): SecurityThreat[] {
    const threats: SecurityThreat[] = [];
    
    for (const { pattern, severity, description } of this.sqlPatterns) {
      const matches = input.match(pattern);
      if (matches) {
        matches.forEach(match => {
          threats.push({
            type: 'sql_injection',
            severity,
            pattern: pattern.source,
            matched: match,
            field,
            confidence: this.calculateConfidence(match, pattern),
            description,
          });
        });
      }
    }

    return threats;
  }

  private scanXss(input: string, field: string): SecurityThreat[] {
    const threats: SecurityThreat[] = [];
    
    for (const { pattern, severity, description } of this.xssPatterns) {
      const matches = input.match(pattern);
      if (matches) {
        matches.forEach(match => {
          threats.push({
            type: 'xss',
            severity,
            pattern: pattern.source,
            matched: match,
            field,
            confidence: this.calculateConfidence(match, pattern),
            description,
          });
        });
      }
    }

    return threats;
  }

  private scanPathTraversal(input: string, field: string): SecurityThreat[] {
    const threats: SecurityThreat[] = [];
    
    for (const { pattern, severity, description } of this.pathTraversalPatterns) {
      const matches = input.match(pattern);
      if (matches) {
        matches.forEach(match => {
          threats.push({
            type: 'path_traversal',
            severity,
            pattern: pattern.source,
            matched: match,
            field,
            confidence: this.calculateConfidence(match, pattern),
            description,
          });
        });
      }
    }

    return threats;
  }

  private scanCommandInjection(input: string, field: string): SecurityThreat[] {
    const threats: SecurityThreat[] = [];
    
    for (const { pattern, severity, description } of this.commandInjectionPatterns) {
      const matches = input.match(pattern);
      if (matches) {
        matches.forEach(match => {
          threats.push({
            type: 'command_injection',
            severity,
            pattern: pattern.source,
            matched: match,
            field,
            confidence: this.calculateConfidence(match, pattern),
            description,
          });
        });
      }
    }

    return threats;
  }

  private scanNosqlInjection(input: string, field: string): SecurityThreat[] {
    const threats: SecurityThreat[] = [];
    
    for (const { pattern, severity, description } of this.nosqlPatterns) {
      const matches = input.match(pattern);
      if (matches) {
        matches.forEach(match => {
          threats.push({
            type: 'nosql_injection',
            severity,
            pattern: pattern.source,
            matched: match,
            field,
            confidence: this.calculateConfidence(match, pattern),
            description,
          });
        });
      }
    }

    return threats;
  }

  private scanLdapInjection(input: string, field: string): SecurityThreat[] {
    const threats: SecurityThreat[] = [];
    
    for (const { pattern, severity, description } of this.ldapPatterns) {
      const matches = input.match(pattern);
      if (matches) {
        matches.forEach(match => {
          threats.push({
            type: 'ldap_injection',
            severity,
            pattern: pattern.source,
            matched: match,
            field,
            confidence: this.calculateConfidence(match, pattern),
            description,
          });
        });
      }
    }

    return threats;
  }

  private scanCustomPatterns(input: string, field: string): SecurityThreat[] {
    const threats: SecurityThreat[] = [];
    
    if (this.config.customPatterns) {
      for (const [type, patterns] of Object.entries(this.config.customPatterns)) {
        for (const pattern of patterns) {
          const matches = input.match(pattern);
          if (matches) {
            matches.forEach(match => {
              threats.push({
                type: type as SecurityThreat['type'],
                severity: 'medium',
                pattern: pattern.source,
                matched: match,
                field,
                confidence: this.calculateConfidence(match, pattern),
                description: `Custom pattern match: ${type}`,
              });
            });
          }
        }
      }
    }

    return threats;
  }

  private calculateConfidence(match: string, pattern: RegExp): number {
    // Simple confidence calculation based on match length and pattern complexity
    const matchLength = match.length;
    const patternComplexity = pattern.source.length;
    
    let confidence = Math.min(0.9, (matchLength + patternComplexity) / 100);
    
    // Boost confidence for exact keyword matches
    if (/\b(SELECT|INSERT|DELETE|script|eval)\b/i.test(match)) {
      confidence = Math.min(1.0, confidence + 0.3);
    }
    
    return Math.max(0.1, confidence);
  }

  private sanitizeInput(input: any, threats: SecurityThreat[]): any {
    if (typeof input !== 'string') {
      return input;
    }

    let sanitized = input;

    // Remove or replace detected threats
    for (const threat of threats) {
      if (threat.severity === 'critical') {
        // Remove critical threats completely
        sanitized = sanitized.replace(new RegExp(threat.matched, 'gi'), '[BLOCKED]');
      } else if (threat.severity === 'high') {
        // Escape high severity threats
        sanitized = sanitized.replace(new RegExp(threat.matched, 'gi'), 
          (match) => match.replace(/[<>"'&]/g, (char) => {
            const entities: { [key: string]: string } = {
              '<': '&lt;',
              '>': '&gt;',
              '"': '&quot;',
              "'": '&#39;',
              '&': '&amp;'
            };
            return entities[char] || char;
          })
        );
      }
    }

    return sanitized;
  }

  private async logThreats(
    threats: SecurityThreat[],
    field: string,
    input: string,
    traceId: string
  ): Promise<void> {
    try {
      for (const threat of threats) {
        await auditEvents.logSecurityThreat({
          traceId,
          tenantId: 'system',
          userId: 'anonymous',
          action: 'security_threat_detected',
          resourceType: 'input_validation',
          result: 'alert',
          metadata: {
            threatType: threat.type,
            severity: threat.severity,
            field,
            pattern: threat.pattern,
            matched: threat.matched,
            confidence: threat.confidence,
            description: threat.description,
            inputLength: input.length,
          },
        });
      }
    } catch (error) {
      console.error('Failed to log security threats:', error);
    }
  }

  /**
   * Scan multiple inputs in batch
   */
  async scanBatch(
    inputs: { [key: string]: any },
    traceId?: string
  ): Promise<{ [key: string]: ScanResult }> {
    const results: { [key: string]: ScanResult } = {};
    
    for (const [field, input] of Object.entries(inputs)) {
      results[field] = await this.scanInput(input, field, traceId);
    }

    return results;
  }

  /**
   * Get threat statistics
   */
  getPatternStats(): {
    sqlPatterns: number;
    xssPatterns: number;
    pathTraversalPatterns: number;
    commandInjectionPatterns: number;
    nosqlPatterns: number;
    ldapPatterns: number;
    customPatterns: number;
  } {
    return {
      sqlPatterns: this.sqlPatterns.length,
      xssPatterns: this.xssPatterns.length,
      pathTraversalPatterns: this.pathTraversalPatterns.length,
      commandInjectionPatterns: this.commandInjectionPatterns.length,
      nosqlPatterns: this.nosqlPatterns.length,
      ldapPatterns: this.ldapPatterns.length,
      customPatterns: this.config.customPatterns 
        ? Object.values(this.config.customPatterns).flat().length 
        : 0,
    };
  }
}

// Global security scanner instance
export const globalSecurityScanner = new SecurityScanner({
  enableBlocking: process.env.NODE_ENV === 'production',
  logThreats: true,
  sanitizeContent: true,
  strictMode: process.env.NODE_ENV === 'production',
});