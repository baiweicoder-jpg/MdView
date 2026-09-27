// Unknown/unsupported timestamps stay unknown; never substitute ctime or now.
function timestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8640000000000000 ? value : null;
}
const statTimes = stat => ({ createdAt: timestamp(stat.birthtimeMs), updatedAt: timestamp(stat.mtimeMs) });
module.exports = { timestamp, statTimes };
