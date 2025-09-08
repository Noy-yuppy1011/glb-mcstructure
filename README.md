# GLB → .mcstructure (Bedrock) – Browser only

- GLB をアップロード → ボクセル解像度（maxDim）を指定 → 1種類のブロックで埋める .mcstructure を生成
- すべて **クライアント側**（GitHub Pages で可）
- ライブラリ:
  - three.js / GLTFLoader – GLB読み込み＆プレビュー
  - three-mesh-bvh – レイキャスト／ボクセル化補助（公式にボクセル例あり）  
  - nbtify – **Little-Endian NBT** 書き込み（Bedrockは NBT だが JE と違い gzip 圧縮なし）  

参考:  
- Bedrock の `.mcstructure` 仕様（フィールド、配列順序、二層 block_indices 等） [oai_citation:11‡Bedrock Wiki](https://wiki.bedrock.dev/nbt/mcstructure)  
- three-mesh-bvh の voxelization 例（考え方） [oai_citation:12‡unpkg.com](https://unpkg.com/browse/three-mesh-bvh%400.7.4/README.md?utm_source=chatgpt.com)  
- ブラウザ向け NBT ライブラリ `nbtify`（CDN可） [oai_citation:13‡jsDelivr](https://www.jsdelivr.com/package/npm/nbtify)

## 生成物の配置
`BP/structures/your_name.mcstructure` に置くと、構造ブロックで `mystructure:your_name` として読み込めます（名前空間/パスの規則は Bedrock Wiki 参照）。 [oai_citation:14‡Bedrock Wiki](https://wiki.bedrock.dev/nbt/mcstructure)

## 注意
- 形状の細部を出すには `maxDim` を上げてください（ただしブロック総数が増えます）。
- 生成したファイルが読み込めない場合は、`block_indices` の総要素数が `size[X]*size[Y]*size[Z]` と一致しているか、二層の配列長が同じかを確認してください。 [oai_citation:15‡Bedrock Wiki](https://wiki.bedrock.dev/nbt/mcstructure)
- `version` はブロックステート互換のための値です。必要に応じて更新してください（Wikiの記載例を初期値にしています）。 [oai_citation:16‡Bedrock Wiki](https://wiki.bedrock.dev/nbt/mcstructure)