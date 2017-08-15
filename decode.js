'use strict';

module.exports = decode;

var Pbf = require('pbf');
var keys, values, lengths, dim, e, blockSize, version;

// cooresponding to tags
var geometryTypes = {
    'Point': 7,
    'Line': 8,
    'Polygon': 9,
    'MultiPoint': 10,
    'MultiLine': 11,
    'MultiPolygon': 12
};

function decode(buffer) {
    initializeBlock();
    var pbf = new Pbf(buffer);
    var obj = pbf.readFields(readDataField, {});
    keys = null;
    return obj;
}

function initializeBlock() {
    dim = 2;
    e = Math.pow(10, 6);
    lengths = null;
    blockSize = 0;
    version = null;
    keys = [];
    values = [];
}

function readDataField(tag, obj, pbf) {
    if (tag === 1) blockSize = pbf.readFixed32();
    else if (tag === 2) pbf.readMessage(readMetadataField, obj);
    else if (tag === 3) readFeatureCollection(pbf, obj);
    else if (tag === 4) readGeometryCollection(pbf, obj);
    else if (tag === 5) closeCollection();
    else if (tag === 6) readFeature(pbf, obj);
    else if (tag > 6 && tag < 13) readGeometry(tag, pbf, obj);
}

function readMetadataField(tag, obj, pbf) {
    if (tag === 1) version = pbf.readVarint();
    else if (tag === 3) dim = pbf.readVarint();
    else if (tag === 4) e = Math.pow(10, pbf.readVarint());
    else if (tag === 5) keys.push(pbf.readString());
    else if (tag === 6) values.push(readValue(pbf));
}

function readFeatureCollection(pbf, obj) {
    obj.type = 'FeatureCollection';
    obj.features = [];
    return pbf.readMessage(readCollectionField, obj);
}

function readGeometryCollection(pbf, obj) {
    obj.type = 'GeometryCollection';
    obj.geometries = [];
    return pbf.readMessage(readCollectionField, obj);
}

function closeCollection() {
    console.error('closing collection');
}

function readFeature(pbf, feature) {
    feature.type = 'Feature';
    return pbf.readMessage(readFeatureField, feature);
}

function readGeometry(tag, pbf, geom) {
    geom.type = geometryTypes[tag];
    return pbf.readMessage(readGeometryField, geom);
}

function readCollectionField(tag, obj, pbf) {
    if (tag === 15) readProps(pbf, obj);
}

function readFeatureField(tag, feature, pbf) {
    if (tag === 1) feature.id = pbf.readString();
    else if (tag === 2) feature.id = pbf.readSVarint();
    else if (tag === 14) feature.properties = readProps(pbf, {});
    else if (tag === 15) readProps(pbf, feature);
}

function readGeometryField(tag, geom, pbf) {
    if (tag === 1) lengths = pbf.readPackedVarint();
    else if (tag === 2) readCoords(geom, pbf, geom.type);
    else if (tag === 15) readProps(pbf, geom);
}

function readCoords(geom, pbf, type) {
    if (type === 'Point') geom.coordinates = readPoint(pbf);
    else if (type === 'MultiPoint') geom.coordinates = readLine(pbf, true);
    else if (type === 'LineString') geom.coordinates = readLine(pbf);
    else if (type === 'MultiLineString') geom.coordinates = readMultiLine(pbf);
    else if (type === 'Polygon') geom.coordinates = readMultiLine(pbf, true);
    else if (type === 'MultiPolygon') geom.coordinates = readMultiPolygon(pbf);
}

function readValue(pbf) {
    var end = pbf.readVarint() + pbf.pos,
        value = null;

    while (pbf.pos < end) {
        var val = pbf.readVarint(),
            tag = val >> 3;

        if (tag === 1) value = pbf.readString();
        else if (tag === 2) value = pbf.readDouble();
        else if (tag === 3) value = pbf.readVarint();
        else if (tag === 4) value = -pbf.readVarint();
        else if (tag === 5) value = pbf.readBoolean();
        else if (tag === 6) value = JSON.parse(pbf.readString());
    }
    return value;
}

function readProps(pbf, props) {
    var end = pbf.readVarint() + pbf.pos;
    while (pbf.pos < end) props[keys[pbf.readVarint()]] = values[pbf.readVarint()];
    values = [];
    return props;
}

function readPoint(pbf) {
    var end = pbf.readVarint() + pbf.pos,
        coords = [];
    while (pbf.pos < end) coords.push(pbf.readSVarint() / e);
    return coords;
}

function readLinePart(pbf, end, len, closed) {
    var i = 0,
        coords = [],
        p, d;

    var prevP = [];
    for (d = 0; d < dim; d++) prevP[d] = 0;

    while (len ? i < len : pbf.pos < end) {
        p = [];
        for (d = 0; d < dim; d++) {
            prevP[d] += pbf.readSVarint();
            p[d] = prevP[d] / e;
        }
        coords.push(p);
        i++;
    }
    if (closed) coords.push(coords[0]);

    return coords;
}

function readLine(pbf) {
    return readLinePart(pbf, pbf.readVarint() + pbf.pos);
}

function readMultiLine(pbf, closed) {
    var end = pbf.readVarint() + pbf.pos;
    if (!lengths) return [readLinePart(pbf, end, null, closed)];

    var coords = [];
    for (var i = 0; i < lengths.length; i++) coords.push(readLinePart(pbf, end, lengths[i], closed));
    lengths = null;
    return coords;
}

function readMultiPolygon(pbf) {
    var end = pbf.readVarint() + pbf.pos;
    if (!lengths) return [[readLinePart(pbf, end, null, true)]];

    var coords = [];
    var j = 1;
    for (var i = 0; i < lengths[0]; i++) {
        var rings = [];
        for (var k = 0; k < lengths[j]; k++) rings.push(readLinePart(pbf, end, lengths[j + 1 + k], true));
        j += lengths[j] + 1;
        coords.push(rings);
    }
    lengths = null;
    return coords;
}
