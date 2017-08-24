'use strict';

module.exports = encode;

var Pbf = require('pbf');

var keys, values, keysNum,
    dim, e, maxPrecision = 1e6;

function encode(obj) {
    var pbf = initializeBlock();
    analyze(obj);
    values = Array.from(values);
    writeObject(obj, pbf);
    return writeBlock(pbf);
}

function initializeBlock() {
    keys = {};
    values = new Set();
    keysNum = 0;
    dim = 0;
    e = 1;
    return new Pbf();
}

function writeMetadata(obj, pbf) {
    e = Math.min(e, maxPrecision);
    var precision = Math.ceil(Math.log(e) / Math.LN10);
    var keysArr = Object.keys(keys);

    pbf.writeVarintField(1, 0);
    if (dim !== 2) pbf.writeVarintField(3, dim);
    if (precision !== 6) pbf.writeVarintField(4, precision);
    for (var i = 0; i < keysArr.length; i++) pbf.writeStringField(5, keysArr[i]);
    for (var k = 0; k < values.length; k++) pbf.writeMessage(6, writeValue, values[k]);
}

function writeBlockSize(blockSize, pbf) {
    pbf.writeFixed32(blockSize);
}

function writeBlock(pbf) {
    var metadata = new Pbf();
    metadata.writeMessage(2, writeMetadata, {});
    metadata = metadata.finish();

    pbf = pbf.finish();
    var blockSize = metadata.length + pbf.length;

    var blockSizePbf = new Pbf();
    blockSizePbf.writeMessage(1, writeBlockSize, blockSize);
    blockSizePbf = blockSizePbf.finish();

    var block = new Uint8Array(blockSizePbf.length + blockSize);
    block.set(blockSizePbf);
    block.set(metadata, blockSizePbf.length);
    block.set(pbf, blockSizePbf.length + metadata.length);

    return block;
}

function analyze(obj) {
    var i, key;

    if (obj.type === 'FeatureCollection') {
        for (i = 0; i < obj.features.length; i++) analyze(obj.features[i]);

    } else if (obj.type === 'Feature') {
        analyze(obj.geometry);
        for (key in obj.properties) saveKeyValue(key, obj.properties[key]);

    } else if (obj.type === 'Point') analyzePoint(obj.coordinates);
    else if (obj.type === 'MultiPoint') analyzePoints(obj.coordinates);
    else if (obj.type === 'GeometryCollection') {
        for (i = 0; i < obj.geometries.length; i++) analyze(obj.geometries[i]);
    }
    else if (obj.type === 'LineString') analyzePoints(obj.coordinates);
    else if (obj.type === 'Polygon' || obj.type === 'MultiLineString') analyzeMultiLine(obj.coordinates);
    else if (obj.type === 'MultiPolygon') {
        for (i = 0; i < obj.coordinates.length; i++) analyzeMultiLine(obj.coordinates[i]);
    }

    for (key in obj) {
        if (!isSpecialKey(key, obj.type)) saveKeyValue(key, null);
    }
}

function analyzeMultiLine(coords) {
    for (var i = 0; i < coords.length; i++) analyzePoints(coords[i]);
}

function analyzePoints(coords) {
    for (var i = 0; i < coords.length; i++) analyzePoint(coords[i]);
}

function analyzePoint(point) {
    dim = Math.max(dim, point.length);

    // find max precision
    for (var i = 0; i < point.length; i++) {
        while (Math.round(point[i] * e) / e !== point[i] && e < maxPrecision) e *= 10;
    }
}

function saveKeyValue(key, value) {
    if (keys[key] === undefined) keys[key] = keysNum++;
    if (!values.has(value)) values.add(value);
}

function writeObject(obj, pbf) {
    if (obj.type === 'FeatureCollection') {
        pbf.writeMessage(3, writeFeatureCollection, obj);
        for (var i = 0; i < obj.features.length; i++) writeObject(obj.features[i], pbf);
        pbf.writeMessage(5, function () {}, {});

    } else if (obj.type === 'GeometryCollection') {
        pbf.writeMessage(4, function () {}, {});
        for (var k = 0; k < obj.geometries.length; k++) writeObject(obj.geometries[k], pbf);
        pbf.writeMessage(5, function () {}, {});

    } else if (obj.type === 'Feature') {
        pbf.writeMessage(6, writeFeature, obj);
        writeGeometry(obj.geometry, pbf);

    } else writeGeometry(obj, pbf);
}

function writeFeatureCollection(obj, pbf) {
    writeProps(obj, pbf, true);
}

function writeFeature(feature, pbf) {
    if (feature.id !== undefined) {
        if (typeof feature.id === 'number' && feature.id % 1 === 0) pbf.writeSVarintField(2, feature.id);
        else pbf.writeStringField(1, feature.id);
    }

    if (feature.properties) writeProps(feature.properties, pbf);
    writeProps(feature, pbf, true);
}

function writeGeometry(geom, pbf) {
    var coords = geom.coordinates;

    if (geom.type === 'Point') pbf.writeMessage(7, writePoint, coords);
    else if (geom.type === 'LineString') pbf.writeMessage(8, writeLine, coords);
    else if (geom.type === 'Polygon') pbf.writeMessage(9, writeMultiLine, {coords: coords, closed: true});
    else if (geom.type === 'MultiPoint') pbf.writeMessage(10, writeLine, coords); // TODO test this, I doubt it was working before
    else if (geom.type === 'MultiLineString') pbf.writeMessage(11, writeMultiLine, {coords: coords});
    else if (geom.type === 'MultiPolygon') pbf.writeMessage(12, writeMultiPolygon, coords);

    writeProps(geom, pbf, true);
}

function writeProps(props, pbf, isCustom) {
    var indexes = [];
    var valuePosition;

    for (var key in props) {
        if (isCustom && isSpecialKey(key, props.type)) {
            continue;
        }

        valuePosition = values.indexOf(props[key]);

        indexes.push(keys[key]);
        indexes.push(valuePosition);
    }

    if (indexes.length) pbf.writePackedVarint(isCustom ? 15 : 14, indexes);
}

function writeValue(value, pbf) {
    var type = typeof value;

    if (type === 'string') pbf.writeStringField(1, value);
    else if (type === 'boolean') pbf.writeBooleanField(5, value);
    else if (type === 'object') pbf.writeStringField(6, JSON.stringify(value));
    else if (type === 'number') {
        if (value % 1 !== 0) pbf.writeDoubleField(2, value);
        else if (value >= 0) pbf.writeVarintField(3, value);
        else pbf.writeVarintField(4, -value);
    }
}

function writePoint(point, pbf) {
    var coords = [];
    for (var i = 0; i < dim; i++) coords.push(Math.round(point[i] * e));
    pbf.writePackedSVarint(2, coords);
}

function writeLine(line, pbf) {
    var coords = [];
    populateLine(coords, line);
    pbf.writePackedSVarint(2, coords);
}

function writeMultiLine(obj, pbf) {
    var lines = obj.coords;
    var closed = obj.closed || false;

    var len = lines.length,
        i;
    if (len !== 1) {
        var lengths = [];
        for (i = 0; i < len; i++) lengths.push(lines[i].length - (closed ? 1 : 0));
        pbf.writePackedVarint(1, lengths);
    }
    var coords = [];
    for (i = 0; i < len; i++) populateLine(coords, lines[i], closed);
    pbf.writePackedSVarint(2, coords);
}

function writeMultiPolygon(polygons, pbf) {
    var len = polygons.length,
        i, j;
    if (len !== 1 || polygons[0].length !== 1) {
        var lengths = [len];
        for (i = 0; i < len; i++) {
            lengths.push(polygons[i].length);
            for (j = 0; j < polygons[i].length; j++) lengths.push(polygons[i][j].length - 1);
        }
        pbf.writePackedVarint(2, lengths);
    }

    var coords = [];
    for (i = 0; i < len; i++) {
        for (j = 0; j < polygons[i].length; j++) populateLine(coords, polygons[i][j], true);
    }
    pbf.writePackedSVarint(2, coords);
}

function populateLine(coords, line, closed) {
    var i, j,
        len = line.length - (closed ? 1 : 0),
        sum = new Array(dim);
    for (j = 0; j < dim; j++) sum[j] = 0;
    for (i = 0; i < len; i++) {
        for (j = 0; j < dim; j++) {
            var n = Math.round(line[i][j] * e) - sum[j];
            coords.push(n);
            sum[j] += n;
        }
    }
}

function isSpecialKey(key, type) {
    if (key === 'type') return true;
    else if (type === 'FeatureCollection') {
        if (key === 'features') return true;
    } else if (type === 'Feature') {
        if (key === 'id' || key === 'properties' || key === 'geometry') return true;
    } else if (type === 'GeometryCollection') {
        if (key === 'geometries') return true;
    } else if (key === 'coordinates') return true;
    return false;
}
