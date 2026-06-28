const COORDINATE_SCALE = 2 ** 32 / 360;

function ensureRange(view, offset, length = 1) {
  if (offset < 0 || offset + length > view.byteLength) {
    throw new Error("The ADM file ended before all GPS records could be read.");
  }
}

function ascii(view, offset, length) {
  ensureRange(view, offset, length);
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  return new TextDecoder("windows-1252").decode(bytes).replace(/\0.*$/s, "").trim();
}

function validPoint(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function mapCoordinate(view, offset) {
  ensureRange(view, offset, 4);
  return view.getInt32(offset, true) / COORDINATE_SCALE;
}

function findDataBlocks(view, blockSize) {
  const blocks = {};
  const limit = Math.floor(view.byteLength / 512);
  for (let block = 3; block <= limit; block += 1) {
    const offset = block * 512 + 1;
    if (offset + 33 > view.byteLength) break;
    const match = ascii(view, offset, 11).match(/^USERDATA(WPT|RTE|TRK|PRX)$/);
    if (!match) continue;
    const length = view.getInt32(offset + 11, true);
    const base = view.getUint16(offset + 31, true) * blockSize;
    if (base > 0 && length > 0 && base + Math.min(length, 6) <= view.byteLength) {
      blocks[match[1]] = { base, length };
    }
  }
  return blocks;
}

function parseWaypoints(view, block) {
  if (!block) return [];
  const { base, length } = block;
  ensureRange(view, base, 79);
  const dataLength = view.getUint32(base + 2, true);
  const count = view.getUint16(base + 33, true);
  const nameLength = view.getUint8(base + 51);
  const commentLength = view.getUint8(base + 55);
  const step = 24 + nameLength + commentLength;
  const end = Math.min(view.byteLength, base + length, base + dataLength);
  const waypoints = [];
  if (!step || count === 0xffff) return waypoints;

  for (let index = 0, offset = base + 78;
    index < count && offset < end;
    index += 1, offset += step) {
    ensureRange(view, offset, step);
    const lat = mapCoordinate(view, offset);
    const lon = mapCoordinate(view, offset + 4);
    if (!validPoint(lat, lon)) continue;
    waypoints.push({
      lat,
      lon,
      name: ascii(view, offset + 8, nameLength) || `Waypoint ${index + 1}`,
      comment: ascii(view, offset + 8 + nameLength, commentLength),
    });
  }
  return waypoints;
}

function parseRoutes(view, block, fixedRoutePoints) {
  if (!block) return [];
  const { base, length } = block;
  ensureRange(view, base, 98);
  const dataLength = view.getUint32(base + 2, true);
  const count = view.getUint16(base + 41, true);
  const routeNameLength = view.getUint16(base + 47, true);
  const pointNameLength = view.getUint16(base + 71, true);
  const pointCommentLength = view.getUint16(base + 75, true);
  const secondNameLength = view.getUint16(base + 91, true);
  const pointStep = fixedRoutePoints
    ? 246
    : 44 + pointNameLength + secondNameLength + pointCommentLength;
  const end = Math.min(view.byteLength, base + length, base + dataLength);
  let routeStart = base + view.getUint16(base + 37, true);
  const routes = [];
  if (!pointStep || count === 0xffff) return routes;

  for (let routeIndex = 0; routeIndex < count; routeIndex += 1) {
    ensureRange(view, routeStart, routeNameLength + 9);
    const name = ascii(view, routeStart, routeNameLength) || `Route ${routeIndex + 1}`;
    routeStart += routeNameLength;
    const pointCount = view.getUint32(routeStart, true);
    const pointStart = routeStart + 9;
    const points = [];
    if (pointCount > 100000 || pointStart >= end) {
      throw new Error(`Route "${name}" contains an unsupported point table.`);
    }
    for (let index = 0, offset = pointStart;
      index < pointCount;
      index += 1, offset += pointStep) {
      ensureRange(view, offset, pointStep);
      const lat = mapCoordinate(view, offset);
      const lon = mapCoordinate(view, offset + 4);
      if (!validPoint(lat, lon)) continue;
      const nameOffset = fixedRoutePoints ? offset + 53 : offset + 8;
      points.push({
        lat,
        lon,
        name: ascii(view, nameOffset, pointNameLength) || `Point ${index + 1}`,
      });
    }
    routes.push({ name, points });
    routeStart += 8 + pointCount * pointStep;
  }
  return routes;
}

function parseTracks(view, block) {
  if (!block) return [];
  const { base, length } = block;
  ensureRange(view, base, 98);
  const dataLength = view.getUint32(base + 2, true);
  const count = view.getUint16(base + 41, true);
  const trackNameLength = view.getUint16(base + 47, true);
  const end = Math.min(view.byteLength, base + length, base + dataLength);
  let trackStart = base + 97;
  const tracks = [];
  if (count === 0xffff) return tracks;

  for (let trackIndex = 0; trackIndex < count; trackIndex += 1) {
    ensureRange(view, trackStart - 8, trackNameLength + 8);
    const name = ascii(view, trackStart - 8, trackNameLength) || `Track ${trackIndex + 1}`;
    trackStart += trackNameLength;
    const pointCount = view.getUint16(trackStart - 8, true);
    const points = [];
    if (pointCount > 100000 || trackStart >= end) {
      throw new Error(`Track "${name}" contains an unsupported point table.`);
    }
    for (let index = 0, offset = trackStart;
      index < pointCount;
      index += 1, offset += 21) {
      ensureRange(view, offset, 21);
      const lat = mapCoordinate(view, offset);
      const lon = mapCoordinate(view, offset + 4);
      if (validPoint(lat, lon)) points.push({ lat, lon });
    }
    tracks.push({ name, points });
    trackStart += 8 + pointCount * 21;
  }
  return tracks;
}

export function parseAdm(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 512 ||
      ascii(view, 16, 6) !== "DSKIMG" ||
      ascii(view, 65, 6) !== "GARMIN" ||
      ascii(view, 73, 8) !== "USERDATA") {
    throw new Error("This is not a supported Garmin UserData.ADM file.");
  }
  const sizeFlag = view.getUint8(98);
  if (sizeFlag < 1 || sizeFlag > 5) {
    throw new Error(`Unsupported Garmin ADM block-size flag: ${sizeFlag}.`);
  }
  const blocks = findDataBlocks(view, 512 * (2 ** sizeFlag));
  if (!blocks.WPT && !blocks.RTE && !blocks.TRK) {
    throw new Error("No waypoint, route, or track data was found in this ADM file.");
  }
  return {
    waypoints: parseWaypoints(view, blocks.WPT),
    routes: parseRoutes(view, blocks.RTE, view.getUint16(26, true) === 0x100),
    tracks: parseTracks(view, blocks.TRK),
  };
}
