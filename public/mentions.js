// Offsets use JavaScript string positions, matching textarea selectionStart.
export function moveMentions(previous, next, mentions) {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let oldEnd = previous.length, newEnd = next.length;
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
  const delta = newEnd - oldEnd;
  return mentions.flatMap(mention => {
    if (oldEnd <= mention.start) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
    if (start >= mention.end) return [mention];
    return [];
  }).filter(mention => next.slice(mention.start, mention.end) === mention.label && !/[\p{L}\p{N}_]/u.test(next[mention.end] || '') && !/[\p{L}\p{N}_]/u.test(next[mention.start - 1] || ''));
}
export function mentionQuery(text, caret, mentions) {
  const match = text.slice(0, caret).match(/(?:^|[\s(])@([\p{L}\p{N} ._-]{0,80})$/u);
  if (!match) return null;
  const start = caret - match[1].length - 1;
  if (mentions.some(mention => mention.start === start)) return null;
  return { start, end: caret, query: match[1].trim() };
}
