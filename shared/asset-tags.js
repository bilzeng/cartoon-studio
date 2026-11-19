export function updateTags(tags = [], add = [], remove = []) {
  const removed = new Set(remove);
  return [...new Set([...tags.filter(tag => !removed.has(tag)), ...add])];
}

export function visibleTags(automatic, custom, hidden) {
  return updateTags(custom, updateTags(automatic, [], hidden));
}
