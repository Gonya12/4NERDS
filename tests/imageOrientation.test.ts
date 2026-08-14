import assert from "node:assert/strict";
import test from "node:test";
import { orientationTransform, readJpegMetadata, type ExifOrientation } from "../src/services/images/imageOrientation.ts";

function jpegWithOrientation(orientation: ExifOrientation, width = 4032, height = 3024) {
  const exif = new Uint8Array(32);
  exif.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  const tiff = new DataView(exif.buffer, 6);
  tiff.setUint16(0, 0x4949, false);
  tiff.setUint16(2, 42, true);
  tiff.setUint32(4, 8, true);
  tiff.setUint16(8, 1, true);
  tiff.setUint16(10, 0x0112, true);
  tiff.setUint16(12, 3, true);
  tiff.setUint32(14, 1, true);
  tiff.setUint16(18, orientation, true);
  tiff.setUint32(22, 0, true);

  const app1Length = exif.length + 2;
  const sof = new Uint8Array([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
  ]);
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff,
    ...exif,
    ...sof,
    0xff, 0xd9,
  ]).buffer;
}

test("reads every common JPEG EXIF orientation and physical source dimensions", () => {
  for (let orientation = 1; orientation <= 8; orientation += 1) {
    assert.deepEqual(readJpegMetadata(jpegWithOrientation(orientation as ExifOrientation)), {
      orientation,
      width: 4032,
      height: 3024,
    });
  }
});

test("swaps output dimensions only for transposed 90-degree orientations", () => {
  for (const orientation of [1, 2, 3, 4] as ExifOrientation[]) {
    const result = orientationTransform(orientation, 4032, 3024);
    assert.equal(result.outputWidth, 4032);
    assert.equal(result.outputHeight, 3024);
  }
  for (const orientation of [5, 6, 7, 8] as ExifOrientation[]) {
    const result = orientationTransform(orientation, 4032, 3024);
    assert.equal(result.outputWidth, 3024);
    assert.equal(result.outputHeight, 4032);
  }
});

test("maps clockwise, counter-clockwise, upside-down, and mirrored orientations", () => {
  assert.deepEqual(orientationTransform(6, 4032, 3024).matrix, [0, 1, -1, 0, 3024, 0]);
  assert.deepEqual(orientationTransform(8, 4032, 3024).matrix, [0, -1, 1, 0, 0, 4032]);
  assert.deepEqual(orientationTransform(3, 4032, 3024).matrix, [-1, 0, 0, -1, 4032, 3024]);
  assert.equal(orientationTransform(2, 4032, 3024).mirrored, true);
  assert.equal(orientationTransform(4, 4032, 3024).mirrored, true);
  assert.equal(orientationTransform(5, 4032, 3024).mirrored, true);
  assert.equal(orientationTransform(7, 4032, 3024).mirrored, true);
});

test("leaves JPEGs without EXIF and non-JPEG bytes unclassified", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;
  assert.deepEqual(readJpegMetadata(jpeg), { orientation: null, width: undefined, height: undefined });
  assert.deepEqual(readJpegMetadata(new Uint8Array([1, 2, 3, 4]).buffer), { orientation: null });
});
