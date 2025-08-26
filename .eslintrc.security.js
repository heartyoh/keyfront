/**
 * ESLint Security Configuration for Keyfront BFF
 * 
 * Specialized security-focused ESLint rules for identifying
 * potential security vulnerabilities in JavaScript/TypeScript code.
 */

module.exports = {
  extends: [
    'plugin:security/recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  
  plugins: [
    'security',
    'no-secrets',
  ],
  
  env: {
    node: true,
    es2022: true,
  },
  
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  
  rules: {
    // Security-specific rules
    'security/detect-unsafe-regex': 'error',
    'security/detect-buffer-noassert': 'error',
    'security/detect-child-process': 'error',
    'security/detect-disable-mustache-escape': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-new-buffer': 'error',
    'security/detect-no-csrf-before-method-override': 'error',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-non-literal-require': 'error',
    'security/detect-object-injection': 'error',
    'security/detect-possible-timing-attacks': 'error',
    'security/detect-pseudoRandomBytes': 'error',
    
    // Secret detection
    'no-secrets/no-secrets': ['error', {
      'tolerance': 4.2,
      'additionalRegexes': [
        // Custom patterns for common secrets
        {
          'regex': '(?i)(password|passwd|pwd|secret|key|token|auth).*[:=].*[\'"][^\'",\n]{8,}[\'"]',
          'description': 'Potential hardcoded credential'
        },
        {
          'regex': 'Bearer [A-Za-z0-9\\-_=]+',
          'description': 'Bearer token'
        },
        {
          'regex': '[\'"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[\'"]',
          'description': 'Hardcoded UUID'
        }
      ]
    }],
    
    // TypeScript security
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    
    // General security best practices
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    'no-console': 'warn',
    'no-debugger': 'error',
    
    // Node.js specific security
    'no-process-exit': 'error',
    'no-process-env': 'warn',
  },
  
  overrides: [
    {
      // Test files can be more lenient
      files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
      rules: {
        'security/detect-non-literal-fs-filename': 'off',
        'no-secrets/no-secrets': 'off',
        'no-console': 'off',
        'security/detect-object-injection': 'off',
      }
    },
    {
      // Configuration files
      files: ['**/*.config.js', '**/jest.setup.js'],
      rules: {
        'security/detect-non-literal-require': 'off',
        'no-process-env': 'off',
      }
    },
    {
      // Benchmark scripts can use more flexible patterns
      files: ['benchmarks/**/*.js'],
      rules: {
        'security/detect-non-literal-fs-filename': 'off',
        'no-console': 'off',
        'security/detect-child-process': 'off',
      }
    }
  ],
  
  settings: {
    // Custom security settings
    'security/patterns': {
      // Additional patterns to detect
      'hardcoded-secrets': [
        'password\\s*[:=]\\s*[\'"][^\'"]+[\'"]',
        'secret\\s*[:=]\\s*[\'"][^\'"]+[\'"]',
        'token\\s*[:=]\\s*[\'"][^\'"]+[\'"]',
      ]
    }
  }
};