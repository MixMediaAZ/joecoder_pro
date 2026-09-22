// A failed exact patch must not cause the same ambiguous search to be retried.
// The next proposal is still entirely model-authored and uses the current files.
export function correctionFormat<T>(parse: (text: string) => T, initiallyWholeFileOnly = false) {
  let wholeFileOnly = initiallyWholeFileOnly;
  return {
    hint: () => wholeFileOnly
      ? 'CORRECTION FORMAT: return complete ===FILE: path=== blocks ending with ===END FILE===. Do not emit PATCH or SEARCH markers. Author the corrected contents from the current files above.'
      : '',
    parse(text: string): T {
      if (wholeFileOnly && /===PATCH:/.test(text)) {
        throw new Error('EDIT_COMPLETE_FILE_REQUIRED: exact-match patching was unavailable; return complete FILE blocks.');
      }
      try { return parse(text); }
      catch (error) {
        if (error instanceof Error && error.message.includes('EDIT_PATCH_REJECTED')) wholeFileOnly = true;
        throw error;
      }
    }
  };
}
