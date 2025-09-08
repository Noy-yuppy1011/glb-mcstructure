// ---- helpers (UI / 3D プレビュー最小) ----
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 16/9, 0.1, 1000);
camera.position.set(2, 2, 4);
scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(1,2,1);
scene.add(dir);

const grid = new THREE.GridHelper(10, 10);
grid.position.y = -0.5;
scene.add(grid);

function frame(){
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- GLB ローダ ----
let loadedMesh = null;

async function loadGLB(file){
  const url = URL.createObjectURL(file);
  const loader = new GLTFLoader();
  return new Promise((resolve, reject)=>{
    loader.load(url, (gltf)=>{
      // 既存消去
      if (loadedMesh) { scene.remove(loadedMesh); loadedMesh = null; }
      // 1つのメッシュに統合
      const group = gltf.scene;
      const geom = new THREE.BufferGeometry();
      const merger = new THREE.BufferGeometry();
      let merged = null;

      group.traverse(o=>{
        if (o.isMesh) {
          const g = o.geometry.clone();
          g.applyMatrix4(o.matrixWorld);
          merged = merged ? THREE.BufferGeometryUtils.mergeGeometries([merged, g]) : g;
        }
      });

      if (!merged) {
        // fallback: bbox cube
        merged = new THREE.BoxGeometry(1,1,1);
      }

      // 表示用メッシュ
      const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.1, roughness: 0.8 });
      loadedMesh = new THREE.Mesh(merged, mat);
      scene.add(loadedMesh);

      // BVH 構築（ray/voxel判定用）
      merged.computeBoundsTree?.(); // three-mesh-bvh が prototype 拡張
      resolve(merged);
    }, undefined, reject);
  });
}

// ---- メッシュをボクセルグリッドに rasterize ----
// 方式: AABB を maxDim で正方格子に量子化し、各セル中心がメッシュ内部かどうかを奇偶判定（raycast）。
// three-mesh-bvh の acceleratedRaycast を使って高速化（公式 example に voxelization があります）。 [oai_citation:4‡unpkg.com](https://unpkg.com/browse/three-mesh-bvh%400.7.4/README.md?utm_source=chatgpt.com)
function voxelize(geometry, maxDim){
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const size = new THREE.Vector3();
  bb.getSize(size);

  const maxSize = Math.max(size.x, size.y, size.z);
  const scale = maxDim / maxSize;

  const dims = new THREE.Vector3(
    Math.ceil(size.x * scale),
    Math.ceil(size.y * scale),
    Math.ceil(size.z * scale)
  );

  // voxel 原点を bbox 最小に合わせる
  const origin = bb.min.clone();

  // 3D -> 1D index (Z Y X 順). Bedrock は ZYX 順で格納。 [oai_citation:5‡Bedrock Wiki](https://wiki.bedrock.dev/nbt/mcstructure)
  const count = dims.x * dims.y * dims.z;
  const primary = new Int32Array(count).fill(-1);   // -1 は「何も置かない」(Bedrock 仕様)  [oai_citation:6‡Bedrock Wiki](https://wiki.bedrock.dev/nbt/mcstructure)
  const secondary = new Int32Array(count).fill(-1);

  const dir = new THREE.Vector3(1, 0, 0); // +X 方向にレイ
  const raycaster = new THREE.Raycaster();

  // 各ボクセル中心で奇偶判定
  const step = new THREE.Vector3(1/scale, 1/scale, 1/scale); // 1ブロックの実寸（モデル空間）
  let placed = 0;

  for (let y=0; y<dims.y; y++){
    for (let z=0; z<dims.z; z++){
      for (let x=0; x<dims.x; x++){
        const cx = origin.x + (x + 0.5) * step.x;
        const cy = origin.y + (y + 0.5) * step.y;
        const cz = origin.z + (z + 0.5) * step.z;

        // レイを左方向へ十分遠くから右へ飛ばす
        const from = new THREE.Vector3(bb.min.x - 1, cy, cz);
        const to = new THREE.Vector3(bb.max.x + 1, cy, cz);
        const dir = to.clone().sub(from).normalize();

        raycaster.set(from, dir);
        // BVH を使った高速ヒットテスト
        const intersects = raycaster.intersectObject(loadedMesh, true);

        // 自身の中心より左側の交差数の奇偶で内外判定
        let inside = false;
        let cross = 0;
        for (const hit of intersects) {
          if (hit.point.x <= cx + 1e-6) cross++;
        }
        inside = (cross % 2) === 1;

        if (inside) {
          const idx = ((x) + dims.x * ( (y) + dims.y * (z) )); // ZYX
          primary[idx] = 0; // palette index 0 を配置
          placed++;
        }
      }
    }
  }

  return { dims, primary, secondary, origin };
}

// ---- Bedrock .mcstructure の NBT（Little-Endian）生成 ----
// 仕様は Bedrock Wiki の .mcstructure ページ参照。format_version=1 / block_indices は2配列 / palette.default.block_palette など。 [oai_citation:7‡Bedrock Wiki](https://wiki.bedrock.dev/nbt/mcstructure)
function buildMcstructure({dims, primary, secondary}, blockId){
  // palette: 1つだけ（index 0）
  const blockStateVersion = 17959425; // Bedrock Wiki 記載例（1.19系の互換値）。 [oai_citation:8‡Bedrock Wiki](https://wiki.bedrock.dev/nbt/mcstructure)

  // nbtify でタグを組み立て
  // すべて「無名ルート Compound」として little-endian でシリアライズ。
  const T = NBTTag;
  const be = NBTEndianness.Little;

  const intList = (arr) => ({ type: T.Int, value: Array.from(arr) });

  const nbtRoot = {
    type: T.Compound,
    name: '', // 無名ルート
    value: {
      format_version: { type: T.Int, value: 1 },
      size: { type: T.List, value: { type: T.Int, value: [dims.x, dims.y, dims.z] } },
      structure_world_origin: { type: T.List, value: { type: T.Int, value: [0,0,0] } },
      structure: {
        type: T.Compound,
        value: {
          block_indices: {
            type: T.List,
            value: {
              type: T.List,
              value: [
                intList(primary),
                intList(secondary)
              ]
            }
          },
          entities: { type: T.List, value: { type: T.Compound, value: [] } },
          palette: {
            type: T.Compound,
            value: {
              default: {
                type: T.Compound,
                value: {
                  block_palette: {
                    type: T.List,
                    value: {
                      type: T.Compound,
                      value: [
                        {
                          type: T.Compound,
                          value: {
                            name: { type: T.String, value: blockId },
                            states: { type: T.Compound, value: {} },
                            version: { type: T.Int, value: blockStateVersion }
                          }
                        }
                      ]
                    }
                  },
                  block_position_data: { type: T.Compound, value: {} }
                }
              }
            }
          }
        }
      }
    }
  };

  const writer = new NBTWriter({ endianness: be });
  const bytes = writer.writeUncompressed(nbtRoot); // Bedrock は無圧縮（JEの.gzipではない）。 [oai_citation:9‡Bedrock Wiki](https://wiki.bedrock.dev/nbt/mcstructure)
  return new Blob([bytes], { type: 'application/octet-stream' });
}

// ---- ワークフロー結合 ----
document.getElementById('convert').addEventListener('click', async ()=>{
  const file = document.getElementById('file').files?.[0];
  if (!file) { alert('GLBファイルを選択してください'); return; }

  const maxDim = Number(document.getElementById('maxDim').value || 64);
  const blockId = (document.getElementById('blockId').value || 'minecraft:stone').trim();

  // GLB 読み込み
  const geom = await loadGLB(file);

  // ボクセル化
  const vox = voxelize(geom, maxDim);

  // .mcstructure 生成
  const blob = buildMcstructure(vox, blockId);

  // ダウンロード
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (file.name.replace(/\.(glb|gltf)$/i, '') || 'model') + '.mcstructure';
  a.click();
});