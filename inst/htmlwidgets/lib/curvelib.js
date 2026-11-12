/**
 * Utility functions for land cover calculations and validation.
 * @module curvelib
 */

/**
 * Checks whether a value is defined.
 * @param {*} v - The value to check.
 * @returns {boolean} True if the value is not undefined, false otherwise.
 */
function is_exist(v) {
  if (typeof v == "undefined") return false;
  return true;
}

/**
 * Validates and rounds an area value to 6 decimal precision, clamping at 0.
 * @param {number} a - The area value in hectares.
 * @returns {number} Non-negative area rounded to 6 decimal places.
 */
function validate_area(a) {
  const precision = 1000000;
  return d3.max([0, Math.round((a + Number.EPSILON) * precision) / precision]);
}

/**
 * Aggregates land cover transition data by zone and land cover category.
 * @param {Array<Object>} lc_data - Array of transition objects with zone_id, lc1_id, lc2_id, and area.
 * @param {boolean} [is_converted_lc=true] - If true, aggregates by destination (lc2_id); if false, by source (lc1_id).
 * @returns {Array<Object>} Aggregated records containing zone_id, lc1_id, and total area.
 */
function sum_lc_area(lc_data, is_converted_lc = true) {
  let sum_area = d3.rollups(
    lc_data,
    (v) => d3.sum(v, (d) => validate_area(d.area)),
    (d) => d.zone_id,
    (d) => (is_converted_lc ? d.lc2_id : d.lc1_id)
  );
  return sum_area
    .map((d) =>
      d[1].map((e) => ({
        zone_id: d[0],
        lc1_id: e[0],
        area: validate_area(e[1]),
      }))
    )
    .flat(1);
}
