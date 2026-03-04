export interface DetectionResult {
  detected: boolean;
  confidence: number; // 0-1
  patterns: string[];
}

// Pattern weights for confidence scoring
const PATTERN_WEIGHTS = {
  stringArray: 0.4,
  hexIdentifiers: 0.2,
  rotateIIFE: 0.2,
  stringFetcher: 0.2,
};

// Regex patterns for Obfuscator.io detection
const PATTERNS = {
  // String array pattern: var _0x[a-f0-9]+ = ['...', '...', ...]
  stringArray: /var\s+_0x[a-f0-9]+\s*=\s*\[[^\]]*(['"][^'"]+['"]\s*,?)+[^\]]*\]/g,

  // Hex-prefixed identifiers: high density of _0x[a-f0-9]{4,6}
  hexIdentifiers: /_0x[a-f0-9]{4,6}/g,

  // Rotate IIFE pattern: (function(_0x..., _0x...){...while(!![]){try{...parseInt...)
  rotateIIFE: /\(function\s*\(\s*_0x[a-f0-9]+\s*,\s*_0x[a-f0-9]+\s*\)\s*\{[^}]*while\s*\(!!\[\]\)/g,

  // String fetching pattern: function _0x...(... , ...){...getStringArray...}
  stringFetcher: /function\s+_0x[a-f0-9]+\s*\([^)]*\)\s*\{[^}]*getStringArray/g,
};

export function detectObfuscation(code: string): DetectionResult {
  const patterns: string[] = [];
  let score = 0;

  // Check each pattern
  if (PATTERNS.stringArray.test(code)) {
    patterns.push('stringArray');
    score += PATTERN_WEIGHTS.stringArray;
  }

  // Count hex identifier density
  const hexMatches = code.match(PATTERNS.hexIdentifiers);
  if (hexMatches && hexMatches.length > 5) {
    patterns.push('hexIdentifiers');
    score += PATTERN_WEIGHTS.hexIdentifiers;
  }

  if (PATTERNS.rotateIIFE.test(code)) {
    patterns.push('rotateIIFE');
    score += PATTERN_WEIGHTS.rotateIIFE;
  }

  if (PATTERNS.stringFetcher.test(code)) {
    patterns.push('stringFetcher');
    score += PATTERN_WEIGHTS.stringFetcher;
  }

  return {
    detected: score >= 0.5,
    confidence: Math.min(score, 1.0),
    patterns,
  };
}
