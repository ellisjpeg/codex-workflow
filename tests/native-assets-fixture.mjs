// Deliberately synthetic geometry: tests must not redistribute native artwork.
export const nativeAssetShapes = {
  plus16:[1,16,16], plus20:[1,20,20], hand:[1,20,20], caret:[1,16,16],
  microphone:[2,20,20], voice:[4,16,16], settings:[2,20,20], profile:[1,20,20],
  'menu-chevron':[1,20,21], 'menu-check':[1,16,16], 'search-clear':[2,20,20], help:[2,20,20], download:[1,20,20],
};
export const nativeAssetsFixture = JSON.stringify(Object.fromEntries(Object.entries(nativeAssetShapes).map(([key,[count,width,height]]) =>
  [key, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="currentColor">${'<path d="M0 0h1v1H0z"/>'.repeat(count)}</svg>`])));
export const isNativeAssetsRead = code => code.startsWith('(async function readWorkflowNativeAssets(');
