function versionParts(version) {
  if (typeof version !== 'string' || !/^\d{4}\.\d{2}\.\d{2}\.\d{2,}$/.test(version)) {
    throw new Error(`Invalid version: ${JSON.stringify(version)}. Expected YYYY.MM.DD.NN.`);
  }
  return version.split('.').map(Number);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const index = a.findIndex((part, i) => part !== b[i]);
  return index === -1 ? 0 : Math.sign(a[index] - b[index]);
}

module.exports = { compareVersions, versionParts };
