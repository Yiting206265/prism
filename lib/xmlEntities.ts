// PubMed's efetch XML uses numeric character references (e.g. `&#x207a;` for
// "⁺") for special characters. fast-xml-parser only decodes the five named
// XML entities (&amp; &lt; &gt; &quot; &apos;), not numeric ones — verified
// directly: parsing '<x>&#x207a;</x>' returns the literal string unchanged.
// This fills that gap. Not needed for arXiv's Atom/RSS feeds.
export function decodeXmlEntities(input: string): string {
  if (!input) return '';
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
