import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
const filename=process.argv[2]??'atlas.json';
const base=new URL('../public/models/',import.meta.url),atlas=JSON.parse(fs.readFileSync(new URL(filename,base)));
assert.equal(atlas.parts.length,2234);assert.equal(atlas.concepts.length,3432);
const ids=new Set(atlas.parts.map(p=>p.id));assert.equal(ids.size,2234);
const files=[];
for(const c of atlas.chunks){
 const raw=new URL(c.url.split('/').pop(),base),gz=new URL(c.gzip.split('/').pop(),base);let b;
 if(fs.existsSync(raw))b=fs.readFileSync(raw);
 else if(fs.existsSync(gz))b=gunzipSync(fs.readFileSync(gz));
 else {const response=await fetch(c.gzip);assert.ok(response.ok,`Could not fetch ${c.gzip}`);b=gunzipSync(Buffer.from(await response.arrayBuffer()));}
 assert.equal(b.length,c.bytes);files.push(b);
}
let tris=0;
for(const p of atlas.parts){assert.ok(p.name.trim()&&p.name!=='-'&&!p.name.includes('Bounds('));assert.ok(p.conceptId!=='-');assert.ok(p.system);const b=files[p.chunk];assert.ok(p.indices+p.indexCount*4<=b.length);const pos=new Float32Array(b.buffer,b.byteOffset+p.positions,p.vertexCount*3),indices=new Uint32Array(b.buffer,b.byteOffset+p.indices,p.indexCount);assert.ok(indices.length>=3);for(const i of indices)assert.ok(i<p.vertexCount,`${p.id}: invalid vertex`);for(const value of pos)assert.ok(Number.isFinite(value));tris+=p.indexCount/3;}
for(const c of atlas.concepts){assert.ok(c.elements.length);for(const id of c.elements)assert.ok(ids.has(id),`${c.id}: missing ${id}`);}
assert.equal(tris,atlas.triangles);
console.log(`Verified ${ids.size} individually indexed meshes, ${atlas.concepts.length} complete concept mappings, ${tris.toLocaleString()} triangles, and every binary buffer.`);
