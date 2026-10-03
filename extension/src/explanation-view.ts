const labels = ['핵심 뜻', '기사에서 확인', '일반적인 설명', '확인할 수 없음'] as const;
export interface ExplanationSection { label?: typeof labels[number]; paragraphs: string[] }

export function explanationSections(text: string): ExplanationSection[] {
  const sections: ExplanationSection[] = [];
  let label: ExplanationSection['label'];
  let lines: string[] = [];
  const flush = () => {
    const paragraphs = lines.join('\n').trim().split(/\n\s*\n/).filter(Boolean);
    if (paragraphs.length) sections.push({ ...(label ? { label } : {}), paragraphs });
    lines = [];
  };
  for (const line of text.split('\n')) {
    const match = /^\[(.+)\]$/.exec(line.trim());
    const next = match?.[1];
    if (labels.includes(next as typeof labels[number])) {
      flush(); label = next as typeof labels[number];
    } else lines.push(line);
  }
  flush();
  return sections;
}
