function countCharacters(text) {
  let count = 0;
  for (const character of text) count++;
  return count;
}

// Index immutable text snapshots off the UI thread. Never execute document content.
self.onmessage = ({ data }) => {
  const { id, generation, text } = data;
  const headings = [];
  let fence = null;
  let offset = 0;
  let words = 0;
  const lines = text.split('\n');
  for (const line of lines) {
    const delimiter = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
    } else if (!fence) {
      const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (match) headings.push({ text: match[2].replace(/[*_`]/g, ''), level: match[1].length, offset });
    }
    for (const _word of line.matchAll(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)) words++;
    offset += line.length + 1;
  }
  self.postMessage({ id, generation, headings, words, characters: countCharacters(text), lines: lines.length, bytes: new TextEncoder().encode(text).byteLength });
};
