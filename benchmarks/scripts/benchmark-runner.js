#!/usr/bin/env node

/**
 * Keyfront BFF Benchmark Runner
 * 
 * Comprehensive benchmark orchestration script for automated performance testing.
 * Supports multiple test scenarios, result aggregation, and trend analysis.
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  baseUrl: process.env.BFF_BASE_URL || 'http://localhost:3000',
  resultsDir: path.join(__dirname, '../results'),
  scenarios: ['smoke', 'load', 'stress'],
  iterations: 3, // Number of test iterations for statistical significance
  
  thresholds: {
    smoke: { rps: 10, p95: 500, errorRate: 0.05 },
    load: { rps: 100, p95: 300, errorRate: 0.01 },
    stress: { rps: 500, p95: 400, errorRate: 0.02 }
  }
};

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

/**
 * Main benchmark runner function
 */
async function main() {
  console.log(`${colors.cyan}${colors.bright}🚀 Keyfront BFF Benchmark Suite${colors.reset}`);
  console.log(`${colors.blue}Target: ${CONFIG.baseUrl}${colors.reset}`);
  console.log(`${colors.blue}Results: ${CONFIG.resultsDir}${colors.reset}`);
  console.log('');

  // Ensure results directory exists
  if (!fs.existsSync(CONFIG.resultsDir)) {
    fs.mkdirSync(CONFIG.resultsDir, { recursive: true });
  }

  // Pre-flight checks
  console.log(`${colors.yellow}📋 Running pre-flight checks...${colors.reset}`);
  await preflightChecks();

  // Run benchmark scenarios
  const results = {};
  
  for (const scenario of CONFIG.scenarios) {
    console.log(`\n${colors.magenta}🧪 Running ${scenario} test scenario...${colors.reset}`);
    results[scenario] = await runBenchmarkScenario(scenario);
  }

  // Generate comprehensive report
  console.log(`\n${colors.green}📊 Generating comprehensive report...${colors.reset}`);
  await generateReport(results);

  console.log(`\n${colors.green}${colors.bright}✅ Benchmark suite completed!${colors.reset}`);
  console.log(`${colors.blue}View results: ${path.join(CONFIG.resultsDir, 'benchmark-report.html')}${colors.reset}`);
}

/**
 * Run pre-flight system checks
 */
async function preflightChecks() {
  const checks = [
    {
      name: 'K6 installation',
      command: 'k6 version',
      validator: (output) => output.includes('k6 v')
    },
    {
      name: 'BFF connectivity',
      command: `curl -s -o /dev/null -w "%{http_code}" ${CONFIG.baseUrl}`,
      validator: (output) => ['200', '404', '500'].includes(output.trim())
    }
  ];

  for (const check of checks) {
    try {
      const output = execSync(check.command, { encoding: 'utf8', timeout: 10000 });
      
      if (check.validator(output)) {
        console.log(`  ${colors.green}✅ ${check.name}${colors.reset}`);
      } else {
        console.log(`  ${colors.red}❌ ${check.name} - Invalid response: ${output}${colors.reset}`);
        process.exit(1);
      }
    } catch (error) {
      console.log(`  ${colors.red}❌ ${check.name} - ${error.message}${colors.reset}`);
      process.exit(1);
    }
  }
}

/**
 * Run a specific benchmark scenario
 */
async function runBenchmarkScenario(scenario) {
  const scenarioResults = [];
  
  for (let i = 1; i <= CONFIG.iterations; i++) {
    console.log(`  ${colors.blue}Run ${i}/${CONFIG.iterations}${colors.reset}`);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultFile = path.join(CONFIG.resultsDir, `${scenario}-run${i}-${timestamp}.json`);
    
    try {
      const k6Command = [
        'k6', 'run',
        '--env', `BENCHMARK_TYPE=${scenario}`,
        '--env', `BFF_BASE_URL=${CONFIG.baseUrl}`,
        '--summary-export', resultFile,
        path.join(__dirname, 'k6-load-test.js')
      ];

      const result = execSync(k6Command.join(' '), { 
        encoding: 'utf8',
        timeout: 600000, // 10 minutes timeout
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });

      // Parse K6 output for quick metrics
      const metrics = parseK6Output(result);
      const fileData = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      
      scenarioResults.push({
        run: i,
        timestamp,
        metrics,
        file: resultFile,
        data: fileData
      });

      console.log(`    ${colors.green}✅ Completed - p95: ${metrics.p95}ms, RPS: ${metrics.rps}${colors.reset}`);
      
    } catch (error) {
      console.log(`    ${colors.red}❌ Failed - ${error.message}${colors.reset}`);
      scenarioResults.push({
        run: i,
        timestamp,
        error: error.message
      });
    }

    // Brief pause between runs
    if (i < CONFIG.iterations) {
      await sleep(5000); // 5 second pause
    }
  }

  return analyzeScenarioResults(scenario, scenarioResults);
}

/**
 * Parse K6 output to extract key metrics
 */
function parseK6Output(output) {
  const lines = output.split('\n');
  const metrics = {
    rps: 0,
    p95: 0,
    p99: 0,
    errorRate: 0,
    avgDuration: 0
  };

  for (const line of lines) {
    if (line.includes('http_req_duration')) {
      const p95Match = line.match(/p\(95\)=([0-9.]+)ms/);
      const p99Match = line.match(/p\(99\)=([0-9.]+)ms/);
      const avgMatch = line.match(/avg=([0-9.]+)ms/);
      
      if (p95Match) metrics.p95 = parseFloat(p95Match[1]);
      if (p99Match) metrics.p99 = parseFloat(p99Match[1]);
      if (avgMatch) metrics.avgDuration = parseFloat(avgMatch[1]);
    } else if (line.includes('http_reqs')) {
      const rpsMatch = line.match(/([0-9.]+)\/s/);
      if (rpsMatch) metrics.rps = parseFloat(rpsMatch[1]);
    } else if (line.includes('http_req_failed')) {
      const errorMatch = line.match(/([0-9.]+)%/);
      if (errorMatch) metrics.errorRate = parseFloat(errorMatch[1]) / 100;
    }
  }

  return metrics;
}

/**
 * Analyze scenario results and calculate statistics
 */
function analyzeScenarioResults(scenario, results) {
  const validResults = results.filter(r => !r.error);
  
  if (validResults.length === 0) {
    return {
      scenario,
      status: 'FAILED',
      error: 'All runs failed',
      results
    };
  }

  // Calculate statistics
  const metrics = ['rps', 'p95', 'p99', 'errorRate', 'avgDuration'];
  const stats = {};
  
  metrics.forEach(metric => {
    const values = validResults.map(r => r.metrics[metric]).filter(v => !isNaN(v));
    
    if (values.length > 0) {
      stats[metric] = {
        avg: values.reduce((a, b) => a + b) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        values
      };
    }
  });

  // Check against thresholds
  const thresholds = CONFIG.thresholds[scenario];
  const passed = {
    rps: !thresholds.rps || (stats.rps && stats.rps.avg >= thresholds.rps),
    p95: !thresholds.p95 || (stats.p95 && stats.p95.avg <= thresholds.p95),
    errorRate: !thresholds.errorRate || (stats.errorRate && stats.errorRate.avg <= thresholds.errorRate)
  };

  const allPassed = Object.values(passed).every(p => p);

  return {
    scenario,
    status: allPassed ? 'PASSED' : 'FAILED',
    iterations: validResults.length,
    stats,
    thresholds,
    passed,
    results: validResults
  };
}

/**
 * Generate comprehensive HTML report
 */
async function generateReport(results) {
  const timestamp = new Date().toISOString();
  const reportData = {
    timestamp,
    baseUrl: CONFIG.baseUrl,
    summary: {},
    scenarios: results
  };

  // Calculate overall summary
  let totalTests = 0, passedTests = 0;
  
  Object.values(results).forEach(scenario => {
    totalTests++;
    if (scenario.status === 'PASSED') passedTests++;
  });

  reportData.summary = {
    totalScenarios: totalTests,
    passedScenarios: passedTests,
    successRate: passedTests / totalTests,
    overall: passedTests === totalTests ? 'PASSED' : 'FAILED'
  };

  // Generate HTML report
  const htmlReport = generateHTMLReport(reportData);
  const reportPath = path.join(CONFIG.resultsDir, 'benchmark-report.html');
  fs.writeFileSync(reportPath, htmlReport);

  // Generate JSON summary
  const jsonPath = path.join(CONFIG.resultsDir, 'benchmark-summary.json');
  fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2));

  console.log(`  📄 HTML Report: ${reportPath}`);
  console.log(`  📄 JSON Summary: ${jsonPath}`);
}

/**
 * Generate HTML report content
 */
function generateHTMLReport(data) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Keyfront BFF Performance Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .summary-card { background: #f8f9fa; padding: 20px; border-radius: 6px; text-align: center; }
        .summary-card.passed { border-left: 5px solid #28a745; }
        .summary-card.failed { border-left: 5px solid #dc3545; }
        .scenario { margin-bottom: 30px; border: 1px solid #ddd; border-radius: 6px; padding: 20px; }
        .scenario.passed { border-left: 5px solid #28a745; }
        .scenario.failed { border-left: 5px solid #dc3545; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-top: 15px; }
        .metric { background: #f8f9fa; padding: 10px; border-radius: 4px; text-align: center; }
        .status { font-weight: bold; padding: 5px 10px; border-radius: 4px; color: white; }
        .status.passed { background: #28a745; }
        .status.failed { background: #dc3545; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: bold; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Keyfront BFF Performance Report</h1>
            <p><strong>Target:</strong> ${data.baseUrl}</p>
            <p><strong>Generated:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
        </div>

        <div class="summary">
            <div class="summary-card ${data.summary.overall.toLowerCase()}">
                <h3>Overall Status</h3>
                <div class="status ${data.summary.overall.toLowerCase()}">${data.summary.overall}</div>
            </div>
            <div class="summary-card">
                <h3>Success Rate</h3>
                <div style="font-size: 2em; font-weight: bold;">${Math.round(data.summary.successRate * 100)}%</div>
            </div>
            <div class="summary-card">
                <h3>Scenarios</h3>
                <div>${data.summary.passedScenarios}/${data.summary.totalScenarios} passed</div>
            </div>
        </div>

        ${Object.values(data.scenarios).map(scenario => `
        <div class="scenario ${scenario.status.toLowerCase()}">
            <h2>${scenario.scenario.toUpperCase()} Test 
                <span class="status ${scenario.status.toLowerCase()}">${scenario.status}</span>
            </h2>
            
            <p><strong>Iterations:</strong> ${scenario.iterations} successful runs</p>
            
            <div class="metrics">
                ${scenario.stats.rps ? `
                <div class="metric">
                    <div><strong>RPS</strong></div>
                    <div>${scenario.stats.rps.avg.toFixed(1)}</div>
                    <div style="font-size: 0.8em; color: #666;">avg</div>
                </div>` : ''}
                
                ${scenario.stats.p95 ? `
                <div class="metric">
                    <div><strong>p95 Response</strong></div>
                    <div>${scenario.stats.p95.avg.toFixed(1)}ms</div>
                    <div style="font-size: 0.8em; color: #666;">avg</div>
                </div>` : ''}
                
                ${scenario.stats.errorRate ? `
                <div class="metric">
                    <div><strong>Error Rate</strong></div>
                    <div>${(scenario.stats.errorRate.avg * 100).toFixed(2)}%</div>
                    <div style="font-size: 0.8em; color: #666;">avg</div>
                </div>` : ''}
            </div>

            <h4>Threshold Analysis</h4>
            <table>
                <tr><th>Metric</th><th>Threshold</th><th>Actual</th><th>Status</th></tr>
                ${scenario.thresholds.rps ? `
                <tr>
                    <td>RPS</td>
                    <td>>= ${scenario.thresholds.rps}</td>
                    <td>${scenario.stats.rps ? scenario.stats.rps.avg.toFixed(1) : 'N/A'}</td>
                    <td><span class="status ${scenario.passed.rps ? 'passed' : 'failed'}">${scenario.passed.rps ? 'PASS' : 'FAIL'}</span></td>
                </tr>` : ''}
                ${scenario.thresholds.p95 ? `
                <tr>
                    <td>p95 Response Time</td>
                    <td><= ${scenario.thresholds.p95}ms</td>
                    <td>${scenario.stats.p95 ? scenario.stats.p95.avg.toFixed(1) : 'N/A'}ms</td>
                    <td><span class="status ${scenario.passed.p95 ? 'passed' : 'failed'}">${scenario.passed.p95 ? 'PASS' : 'FAIL'}</span></td>
                </tr>` : ''}
                ${scenario.thresholds.errorRate ? `
                <tr>
                    <td>Error Rate</td>
                    <td><= ${(scenario.thresholds.errorRate * 100).toFixed(1)}%</td>
                    <td>${scenario.stats.errorRate ? (scenario.stats.errorRate.avg * 100).toFixed(2) : 'N/A'}%</td>
                    <td><span class="status ${scenario.passed.errorRate ? 'passed' : 'failed'}">${scenario.passed.errorRate ? 'PASS' : 'FAIL'}</span></td>
                </tr>` : ''}
            </table>
        </div>
        `).join('')}

        <div class="footer">
            <p>Generated by Keyfront BFF Benchmark Suite v1.0.0</p>
            <p>For detailed metrics and analysis, review the individual JSON result files</p>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Sleep utility function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`${colors.red}❌ Benchmark suite failed:${colors.reset}`, error);
    process.exit(1);
  });
}

export default { main, CONFIG };