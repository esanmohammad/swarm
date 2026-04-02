import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface AmbiguityAnalysis {
  vaguenessScore: number;       // 0-100
  scopeSize: 'small' | 'medium' | 'large';
  riskFactors: string[];
  missingContext: string[];
  classification: 'clear-small' | 'clear-large' | 'ambiguous' | 'risky';
  estimatedCost: number;
  estimatedFiles: number;
  questions: string[];
  options: ScopeOption[];
}

export interface ScopeOption {
  name: string;
  description: string;
  estimatedCost: number;
  estimatedTime: string;
  risk: 'low' | 'medium' | 'high';
  tradeoffs: string[];
  recommended: boolean;
}

export interface ScopeDocument {
  willBuild: string[];
  willNotBuild: string[];
  assumptions: string[];
  estimatedCost: number;
  approach: string;
  risk: string;
}

const RISK_KEYWORDS = ['auth', 'payment', 'billing', 'database', 'migration', 'deploy', 'security', 'delete', 'remove'];
const GENERIC_TERMS = ['add', 'fix', 'update', 'change', 'improve', 'make', 'do', 'create', 'build', 'handle'];
const SPECIFIC_INDICATORS = ['.ts', '.tsx', '.js', '.py', '.go', '.rs', 'function', 'class', 'component', 'endpoint', 'api', 'route', 'hook', 'middleware', 'handler', 'service', 'module'];

function countProjectFiles(cwd: string): number {
  try {
    const output = execSync('git ls-files | wc -l', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
    return parseInt(output, 10) || 0;
  } catch {
    // Fallback: count files in top-level dirs (shallow)
    try {
      let count = 0;
      const entries = readdirSync(cwd);
      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
        try {
          const st = statSync(join(cwd, entry));
          if (st.isFile()) count++;
          else if (st.isDirectory()) {
            count += readdirSync(join(cwd, entry)).length;
          }
        } catch { /* skip */ }
      }
      return count;
    } catch {
      return 50; // fallback estimate
    }
  }
}

function scoreVagueness(request: string): number {
  let score = 0;
  const lower = request.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // Short requests are vague
  if (lower.length < 20) score += 35;
  else if (lower.length < 50) score += 20;
  else if (lower.length < 100) score += 10;

  // Word count
  if (words.length < 5) score += 20;
  else if (words.length < 10) score += 10;

  // Generic verbs without specifics
  const startsWithGeneric = GENERIC_TERMS.some(t => lower.startsWith(t));
  if (startsWithGeneric) score += 10;

  const genericCount = words.filter(w => GENERIC_TERMS.includes(w)).length;
  score += Math.min(genericCount * 5, 15);

  // Specific indicators reduce vagueness
  const specificCount = SPECIFIC_INDICATORS.filter(s => lower.includes(s)).length;
  score -= Math.min(specificCount * 8, 30);

  // No file/path mentions = more vague
  const hasPath = /[\/\\]/.test(request) || /\.\w{1,4}$/.test(request.trim());
  if (!hasPath) score += 10;

  return Math.max(0, Math.min(100, score));
}

function detectRiskFactors(request: string): string[] {
  const lower = request.toLowerCase();
  const factors: string[] = [];

  for (const keyword of RISK_KEYWORDS) {
    if (lower.includes(keyword)) {
      const descriptions: Record<string, string> = {
        auth: 'Authentication changes can break user access',
        payment: 'Payment logic is business-critical and legally sensitive',
        billing: 'Billing changes affect revenue and compliance',
        database: 'Database changes can cause data loss if not migrated properly',
        migration: 'Migrations are destructive and hard to reverse',
        deploy: 'Deployment changes affect production availability',
        security: 'Security changes require careful review',
        delete: 'Deletion operations can cause permanent data loss',
        remove: 'Removal operations can break dependent features',
      };
      factors.push(descriptions[keyword] || `Involves ${keyword} — requires careful review`);
    }
  }

  return factors;
}

function findMissingContext(request: string): string[] {
  const lower = request.toLowerCase();
  const missing: string[] = [];

  if (!SPECIFIC_INDICATORS.some(s => lower.includes(s))) {
    missing.push('No specific files or components mentioned');
  }
  if (!/\b(api|endpoint|route|page|view|component|service|model|schema)\b/.test(lower)) {
    missing.push('No architectural layer specified (API, UI, service, model)');
  }
  if (!/\b(user|admin|public|internal|customer)\b/.test(lower)) {
    missing.push('No target audience or access level specified');
  }
  if (!/\b(must|should|require|need|want)\b/.test(lower)) {
    missing.push('No explicit requirements or constraints stated');
  }
  if (!/\b(test|verify|validate|check)\b/.test(lower)) {
    missing.push('No success criteria or testing approach mentioned');
  }

  return missing;
}

function generateQuestions(request: string, missing: string[], riskFactors: string[]): string[] {
  const questions: string[] = [];
  const lower = request.toLowerCase();

  if (missing.some(m => m.includes('files or components'))) {
    questions.push('Which specific files or components should be changed?');
  }
  if (missing.some(m => m.includes('architectural layer'))) {
    questions.push('Should this change the API, the UI, both, or just internal logic?');
  }
  if (missing.some(m => m.includes('audience'))) {
    questions.push('Who is the target user for this change?');
  }
  if (missing.some(m => m.includes('requirements'))) {
    questions.push('What are the must-have requirements vs nice-to-haves?');
  }
  if (missing.some(m => m.includes('success criteria'))) {
    questions.push('How will you verify this change works correctly?');
  }
  if (riskFactors.length > 0) {
    questions.push('Are there existing tests covering the affected area?');
    questions.push('Is there a rollback plan if something goes wrong?');
  }
  if (lower.includes('add') || lower.includes('create') || lower.includes('build')) {
    questions.push('Should this integrate with existing patterns or introduce a new approach?');
  }
  if (lower.includes('fix') || lower.includes('bug')) {
    questions.push('Can you provide steps to reproduce the issue?');
  }

  return questions.slice(0, 6); // Cap at 6 questions
}

function generateOptions(request: string, vagueness: number, fileCount: number, riskFactors: string[]): ScopeOption[] {
  const isRisky = riskFactors.length > 0;
  const baseCost = fileCount > 200 ? 2.0 : fileCount > 50 ? 1.0 : 0.5;

  const options: ScopeOption[] = [];

  // Minimal option
  options.push({
    name: 'Minimal',
    description: 'Smallest viable change — only the core requirement with no extras',
    estimatedCost: baseCost,
    estimatedTime: fileCount > 200 ? '10-20 min' : '5-10 min',
    risk: 'low',
    tradeoffs: [
      'Fastest and cheapest',
      'May miss edge cases',
      'No additional tests or documentation',
      'Might need follow-up work',
    ],
    recommended: !isRisky && vagueness < 40,
  });

  // Balanced option
  options.push({
    name: 'Balanced',
    description: 'Core requirement plus tests, error handling, and basic documentation',
    estimatedCost: baseCost * 2.5,
    estimatedTime: fileCount > 200 ? '20-40 min' : '10-25 min',
    risk: isRisky ? 'medium' : 'low',
    tradeoffs: [
      'Good balance of speed and quality',
      'Includes test coverage',
      'Handles common edge cases',
      'Moderate cost',
    ],
    recommended: true, // default recommendation
  });

  // Comprehensive option
  options.push({
    name: 'Comprehensive',
    description: 'Full implementation with tests, docs, error handling, logging, and review',
    estimatedCost: baseCost * 5,
    estimatedTime: fileCount > 200 ? '40-90 min' : '25-50 min',
    risk: isRisky ? 'medium' : 'low',
    tradeoffs: [
      'Most thorough approach',
      'Full test coverage',
      'Documentation included',
      'Higher cost and time',
    ],
    recommended: isRisky,
  });

  // If risky, mark balanced as not recommended in favor of comprehensive
  if (isRisky) {
    options[1]!.recommended = false;
  }

  return options;
}

function classifyRequest(vagueness: number, riskFactors: string[], fileCount: number): AmbiguityAnalysis['classification'] {
  if (riskFactors.length > 0) return 'risky';
  if (vagueness > 50) return 'ambiguous';
  if (fileCount > 200) return 'clear-large';
  return 'clear-small';
}

function estimateScopeSize(fileCount: number, vagueness: number): AmbiguityAnalysis['scopeSize'] {
  if (fileCount > 200 || vagueness > 60) return 'large';
  if (fileCount > 50 || vagueness > 30) return 'medium';
  return 'small';
}

export function analyzeAmbiguity(request: string, cwd: string): AmbiguityAnalysis {
  const fileCount = countProjectFiles(cwd);
  const vaguenessScore = scoreVagueness(request);
  const riskFactors = detectRiskFactors(request);
  const missingContext = findMissingContext(request);
  const classification = classifyRequest(vaguenessScore, riskFactors, fileCount);
  const scopeSize = estimateScopeSize(fileCount, vaguenessScore);
  const questions = generateQuestions(request, missingContext, riskFactors);
  const options = generateOptions(request, vaguenessScore, fileCount, riskFactors);

  const baseCost = fileCount > 200 ? 2.0 : fileCount > 50 ? 1.0 : 0.5;
  const estimatedCost = baseCost * (vaguenessScore > 50 ? 3 : vaguenessScore > 30 ? 2 : 1.5);
  const estimatedFiles = Math.max(1, Math.round(fileCount * (vaguenessScore > 50 ? 0.1 : 0.03)));

  return {
    vaguenessScore,
    scopeSize,
    riskFactors,
    missingContext,
    classification,
    estimatedCost,
    estimatedFiles,
    questions,
    options,
  };
}

export function generateScopeDocument(
  request: string,
  chosenOption: ScopeOption,
  analysis: AmbiguityAnalysis,
): ScopeDocument {
  const willBuild: string[] = [];
  const willNotBuild: string[] = [];
  const assumptions: string[] = [];

  // Build items based on option level
  willBuild.push(`Core: ${request}`);

  if (chosenOption.name === 'Balanced' || chosenOption.name === 'Comprehensive') {
    willBuild.push('Unit tests for new/changed code');
    willBuild.push('Error handling for common failure modes');
  }
  if (chosenOption.name === 'Comprehensive') {
    willBuild.push('Integration tests');
    willBuild.push('Documentation updates');
    willBuild.push('Logging and observability');
  }

  // Will NOT build
  if (chosenOption.name === 'Minimal') {
    willNotBuild.push('Tests (follow up separately)');
    willNotBuild.push('Documentation updates');
    willNotBuild.push('Error handling beyond basic cases');
  }
  if (chosenOption.name !== 'Comprehensive') {
    willNotBuild.push('Performance optimization');
    willNotBuild.push('Migration scripts (if applicable)');
  }
  willNotBuild.push('Unrelated refactoring');

  // Assumptions
  assumptions.push('Existing codebase patterns will be followed');
  assumptions.push('Current dependencies are sufficient');
  if (analysis.riskFactors.length > 0) {
    assumptions.push('Risk areas will be reviewed manually before merge');
  }
  if (analysis.missingContext.length > 0) {
    assumptions.push('Ambiguous requirements will be interpreted conservatively');
  }

  // Risk description
  let risk = 'Low — straightforward change with minimal dependencies';
  if (analysis.riskFactors.length > 0) {
    risk = `Medium-High — ${analysis.riskFactors[0]}`;
  } else if (analysis.vaguenessScore > 50) {
    risk = 'Medium — vague requirements may lead to rework';
  }

  return {
    willBuild,
    willNotBuild,
    assumptions,
    estimatedCost: chosenOption.estimatedCost,
    approach: `${chosenOption.name}: ${chosenOption.description}`,
    risk,
  };
}
