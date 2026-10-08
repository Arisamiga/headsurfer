#!/usr/bin/env node
/**
 * Offline helper: optimises heavy 3D source models (4096² PBR, ~80k triangles)
 * into lightweight browser GLBs. Outputs are committed to public/assets/models,
 * so neither npm ci nor Docker installs these tools.
 *
 * One-off setup outside the app dependencies:
 *   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 \
 *     @gltf-transform/functions@4 meshoptimizer sharp
 * Usage: node scripts/optimize-models.mjs <in.glb> <out.glb> <triangles> [textureSize]
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, dequantize, meshopt, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const [input, output, triangleArg, textureArg = "1024"] = process.argv.slice(2);
if (!input || !output || !triangleArg) {
  console.error("Usage: node scripts/optimize-models.mjs <in.glb> <out.glb> <triangles> [textureSize]");
  process.exit(2);
}
const targetTriangles = Number(triangleArg);
const textureSize = Number(textureArg);

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
});
const document = await io.read(input);
const triangles = () => document.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives())
  .reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION").getCount()) / 3, 0);
const before = triangles();

await document.transform(dequantize(), weld());
if (before > targetTriangles) {
  await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: targetTriangles / before, error: 0.02 }));
}

// The game only needs readable colour detail. Each 4096² normal/ORM map costs
// tens of MB of GPU memory; a matte base-colour material is far lighter on phones.
for (const material of document.getRoot().listMaterials()) {
  material.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
  material.setMetallicFactor(0).setRoughnessFactor(0.86);
}
await document.transform(
  prune(),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [textureSize, textureSize], quality: 80 }),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
await io.write(output, document);
console.log(`${output}: ${Math.round(before)} -> ${Math.round(triangles())} triangles, ${textureSize}px texture`);
