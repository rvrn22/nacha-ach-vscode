export type AchDetectionResult = {
  isLikelyAch: boolean;
  confidence: number;
  reasons: string[];
};

export function detectAchContent(text: string): AchDetectionResult {
  const lines = text.split(/\r?\n/).filter(line => line.length > 0).slice(0, 500);
  const reasons: string[] = [];
  if (lines.length < 4) { return { isLikelyAch: false, confidence: 0, reasons }; }

  let score = 0;
  const fixedWidthRatio = lines.filter(line => line.length === 94).length / lines.length;
  if (fixedWidthRatio >= 0.95) {
    score += 0.35;
    reasons.push('Nearly all records contain 94 characters');
  }
  if (lines[0].startsWith('101')) {
    score += 0.25;
    reasons.push('First record begins with the ACH File Header signature 101');
  }
  const nonPadding = lines.filter(line => !/^9{94}$/.test(line));
  const recordTypesValid = nonPadding.every(line => ['1', '5', '6', '7', '8', '9'].includes(line.charAt(0)));
  if (recordTypesValid) {
    score += 0.15;
    reasons.push('Record type codes follow the ACH record set');
  }
  const types = new Set(nonPadding.map(line => line.charAt(0)));
  if (types.has('5') && types.has('6') && types.has('8')) {
    score += 0.15;
    reasons.push('Contains a Batch Header, Entry Detail, and Batch Control');
  }
  const fileControl = nonPadding.find(line => line.charAt(0) === '9');
  if (fileControl) {
    score += 0.10;
    reasons.push('Contains a File Control record');
  }
  return { isLikelyAch: score >= 0.8, confidence: Math.min(score, 1), reasons };
}
