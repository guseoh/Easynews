import type { ExplainInput } from './explain.js';

export const TOOLS_MARKER = '\n\n[EASYNEWS_TOOLS]\n';
export interface EvidenceQuote { quote: string; source: 'selectedText' | 'surroundingContext' }
export interface ReadingTools { suggestedQuestions?: string[]; evidence?: EvidenceQuote[] }

export function parseReadingTools(text: string, input: ExplainInput): { answer: string } & ReadingTools {
  if (!input.readingTools) return { answer: text };
  const index = text.indexOf(TOOLS_MARKER);
  if (index < 0) return { answer: text };
  const result: { answer: string } & ReadingTools = { answer: text.slice(0, index).trim() };
  try {
    const value: unknown = JSON.parse(text.slice(index + TOOLS_MARKER.length));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    if ('suggestedQuestions' in value && Array.isArray(value.suggestedQuestions)) {
      const questions = value.suggestedQuestions.filter((question): question is string => typeof question === 'string'
        && question.trim().length >= 5 && question.length <= 300).map((question) => question.trim());
      result.suggestedQuestions = [...new Set(questions)].slice(0, 2);
    }
    if ('evidence' in value && Array.isArray(value.evidence) && result.answer.includes('[기사에서 확인]')) {
      const evidence: EvidenceQuote[] = [];
      for (const item of value.evidence) {
        if (!item || typeof item !== 'object' || typeof item.quote !== 'string'
          || !['selectedText', 'surroundingContext'].includes(item.source)) continue;
        const source = item.source as EvidenceQuote['source'];
        const quote = item.quote.trim();
        if (quote.length < 2 || quote.length > 240 || !input[source]?.includes(quote)
          || evidence.some((entry) => entry.quote === quote && entry.source === source)) continue;
        evidence.push({ quote, source });
        if (evidence.length === 3) break;
      }
      result.evidence = evidence;
    }
  } catch { /* Optional tools must not make a completed explanation unusable. */ }
  return result;
}

// Keep the metadata and a split marker out of the visible explanation stream.
export class ReadingToolsStream {
  private text = '';
  private sent = 0;
  push(delta: string): string {
    this.text += delta;
    const index = this.text.indexOf(TOOLS_MARKER);
    let end = index < 0 ? this.text.length : index;
    if (index < 0) {
      for (let length = Math.min(TOOLS_MARKER.length - 1, this.text.length); length > 0; length--) {
        if (this.text.endsWith(TOOLS_MARKER.slice(0, length))) { end -= length; break; }
      }
    }
    const visible = this.text.slice(this.sent, end);
    this.sent = end;
    return visible;
  }
}
