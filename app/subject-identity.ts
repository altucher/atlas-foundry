const stopWords = new Set(['a', 'an', 'the', 'of', 'and', 'for', 'with', 'system', 'systems', 'component', 'components', 'atlas']);

function tokenVariants(term: string) {
  const variants = new Set([term]);
  if (term === 'mac') variants.add('macintosh');
  if (term === 'macintosh') variants.add('mac');
  if (term.length > 4 && term.endsWith('ies')) {
    // Covers ordinary plurals (batteries → battery) and names whose singular
    // already ends in "ie" (Twinkies → Twinkie).
    variants.add(`${term.slice(0, -3)}y`);
    variants.add(term.slice(0, -1));
  } else if (term.length > 4 && term.endsWith('es')) {
    variants.add(term.slice(0, -2));
    variants.add(term.slice(0, -1));
  } else if (term.length > 3 && term.endsWith('s') && !term.endsWith('ss')) {
    variants.add(term.slice(0, -1));
  }
  return variants;
}

function identityTerms(value: string) {
  return value
    .replace(/[™®©]/g, ' ')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\bzero\b/g, '0')
    .replace(/\bone\b/g, '1')
    .replace(/\btwo\b/g, '2')
    .replace(/\bthree\b/g, '3')
    .replace(/\bfour\b/g, '4')
    .replace(/\bfive\b/g, '5')
    .replace(/\bsix\b/g, '6')
    .replace(/\bseven\b/g, '7')
    .replace(/\beight\b/g, '8')
    .replace(/\bnine\b/g, '9')
    .replace(/\bten\b/g, '10')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((term) => (term.length > 1 || /^\d$/.test(term)) && !stopWords.has(term));
}

export function subjectMatchesRequest(requested: string, returned: string) {
  const requestedTerms = identityTerms(requested);
  const returnedVariants = new Set(identityTerms(returned).flatMap((term) => [...tokenVariants(term)]));
  if (!requestedTerms.length || !returnedVariants.size) return false;
  const sharedTerms = requestedTerms.filter((term) => [...tokenVariants(term)].some((variant) => returnedVariants.has(variant)));
  // A single coincidental token (a model number such as "787", for example)
  // must never be enough to turn a Boeing request into a different product.
  const requiredMatches = requestedTerms.length === 1 ? 1 : Math.ceil(requestedTerms.length * 0.6);
  return sharedTerms.length >= requiredMatches;
}

export function canonicalResearchPrompt(prompt: string) {
  // “Eight mattress” is a common shorthand for the Eight Sleep smart mattress
  // system. Preserve the user's text in the UI while making the research target
  // explicit enough to avoid treating the number as a mattress size or quantity.
  if (/^\s*(?:(?:a|an|the)\s+)?(?:eight|8)(?:\s+sleep)?\s+mattress(?:es)?\s*$/i.test(prompt)) {
    return 'Eight Sleep smart mattress system';
  }
  // The 1984 Macintosh 512K is routinely called the Mac 512K. Use the
  // official product name for research and cache identity without broadening
  // the request to a different compact Macintosh model.
  if (/^\s*(?:(?:a|an|the)\s+)?(?:apple\s+)?(?:mac|macintosh)\s*512\s*k\s*$/i.test(prompt)) {
    return 'Macintosh 512K';
  }
  return prompt;
}
