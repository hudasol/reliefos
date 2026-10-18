import type { ContentFlag } from '../../shared/types.js';

// Product listings are untrusted input. This scanner looks for content that tries to act as
// instructions to a purchasing agent (prompt injection) or smuggles hidden text. A blocking flag
// quarantines the candidate: the planner will not select it and the policy gate will deny any
// proposal that contains it, regardless of what a model concluded.

interface Rule {
  id: string;
  pattern: RegExp;
  severity: 'block' | 'warn';
}

const RULES: Rule[] = [
  { id: 'instruction-override', pattern: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|all|system|your)\b[^.\n]{0,20}\b(instructions?|rules?|polic(y|ies)|constraints?|prompts?)/i, severity: 'block' },
  { id: 'role-impersonation', pattern: /(^|[\n.!?]\s*|[[(<])(system|assistant|developer)\s*[:>\]]/i, severity: 'block' },
  { id: 'agent-addressing', pattern: /\b(AI|LLM|language model|purchasing|buyer|shopping)\s+(agent|assistant|model|bot)s?\b[^.\n]{0,60}\b(must|should|shall|are required|are instructed|need to)\b/i, severity: 'block' },
  { id: 'authority-manipulation', pattern: /\b(pre-?approved|already approved|approval (is )?(not )?(needed|required)|auto-?approve|bypass|skip)\b[^.\n]{0,40}\b(approval|review|policy|budget|limit|check|gate)/i, severity: 'block' },
  { id: 'budget-manipulation', pattern: /\b(increase|raise|ignore|exceed|lift|remove)\b[^.\n]{0,30}\b(budget|spending limit|spend limit|cap)\b/i, severity: 'block' },
  { id: 'quantity-manipulation', pattern: /\b(buy|order|purchase|add)\s+(at least\s+)?\d{2,}\s*(units|packs|cases|more)\b/i, severity: 'block' },
  { id: 'payment-redirection', pattern: /\b(send|wire|transfer|pay)\b[^.\n]{0,40}\b(to|via)\b[^.\n]{0,40}(paypal\.me|venmo|crypto|bitcoin|wallet|account number|iban)/i, severity: 'block' },
  { id: 'prompt-markup', pattern: /(<\/?(system|instructions?|prompt)>|\[\/?INST\]|<\|im_(start|end)\|>|###\s*(system|instruction))/i, severity: 'block' },
  { id: 'hidden-characters', pattern: /[​-‏‪-‮⁠-⁤﻿]/, severity: 'block' },
  { id: 'urgency-pressure', pattern: /\b(urgent|immediately|right now)\b[^.\n]{0,40}\b(approve|purchase|checkout|confirm)\b/i, severity: 'warn' },
];

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/[​-‏‪-‮⁠-⁤﻿]/g, '⟨hidden⟩') + (end < text.length ? '…' : '');
}

export function scanContent(fields: { title?: string | null; description?: string | null; merchant?: string | null }): ContentFlag[] {
  const flags: ContentFlag[] = [];
  for (const [field, value] of Object.entries(fields) as [ContentFlag['field'], string | null | undefined][]) {
    if (!value) continue;
    for (const rule of RULES) {
      const m = rule.pattern.exec(value);
      if (m) flags.push({ rule: rule.id, field, excerpt: excerptAround(value, m.index, m[0].length), severity: rule.severity });
    }
  }
  return flags;
}

export const isBlocking = (flags: readonly ContentFlag[]) => flags.some((f) => f.severity === 'block');

/**
 * Prepare untrusted text for inclusion in a model prompt: strip hidden characters, collapse
 * whitespace, cap length. The caller still wraps it in an explicit untrusted-data envelope.
 */
export function sanitizeForPrompt(text: string | null | undefined, maxLength = 600): string {
  if (!text) return '';
  return text
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›'))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
