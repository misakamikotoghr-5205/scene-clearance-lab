# 相近开源工具、实际复用与差异

核对日期：2026-11-04。3D预览、glTF导入、场景布置与碰撞检测都是成熟方向；本项目不宣称创造新类别。这里比较的是已读取的固定版本 README 与许可，完整文件指纹见 `source-versions.json`。

## 已有工具

| 来源                                                                                                                                                            | 既有能力                                                                                                                                                                                                                                                                                               | 本项目差异与缺口                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [glTF Viewer](https://github.com/donmccurdy/three-gltf-viewer/tree/e10c599170ae0552fd74660bce15fbbe93f7f11a)，commit `e10c599170ae0552fd74660bce15fbbe93f7f11a` | [README](https://github.com/donmccurdy/three-gltf-viewer/blob/e10c599170ae0552fd74660bce15fbbe93f7f11a/README.md) 明确提供基于Three.js的拖放glTF 2.0预览；[MIT许可](https://github.com/donmccurdy/three-gltf-viewer/blob/e10c599170ae0552fd74660bce15fbbe93f7f11a/LICENSE)。                           | 成熟查看器更适合一般资产/材质查看。留白实验室只支持明确的几何子集，材质保真与扩展兼容性更弱；增加的是多物件水平布置、可解释间距代理、A/B参数核对和placement报告。未复制其代码或素材。     |
| [glTF Transform](https://github.com/donmccurdy/glTF-Transform/tree/8e2a94a2616d293c4b503d0fb6a4b42e6ec7c62f)，commit `8e2a94a2616d293c4b503d0fb6a4b42e6ec7c62f` | [README](https://github.com/donmccurdy/glTF-Transform/blob/8e2a94a2616d293c4b503d0fb6a4b42e6ec7c62f/README.md) 的SDK和CLI可读写/编辑/优化glTF，并管理低层索引和偏移，支持Web和Node；[MIT许可](https://github.com/donmccurdy/glTF-Transform/blob/8e2a94a2616d293c4b503d0fb6a4b42e6ec7c62f/LICENSE.md)。 | 它的格式/扩展能力远强于我们的有限读取器；本项目没有提供通用优化器或完整glTF导出。我们把范围收窄到离线几何布置、避免解析外部URI及可复核的距离说明。仅借鉴设计方向，没有导入或复制SDK代码。 |
| [Three.js r180](https://github.com/mrdoob/three.js/tree/0af9729d0c143a86a1d725d6e2c3ad83301f3f34)，NPM `three@0.180.0`                                          | 通用3D渲染库；[README](https://github.com/mrdoob/three.js/blob/0af9729d0c143a86a1d725d6e2c3ad83301f3f34/README.md) 与 [MIT许可](https://github.com/mrdoob/three.js/blob/0af9729d0c143a86a1d725d6e2c3ad83301f3f34/LICENSE) 已读取。                                                                     | **实际复用**其渲染与OrbitControls，不把渲染引擎算作本项目自研。未引入它的示例3D模型或其他美术资产。                                                                                       |

## 具体复用与许可

从官方NPM包固定版本 `three@0.180.0` 原样保留：`three.module.js`、`three.core.js`、`examples/jsm/controls/OrbitControls.js`、`LICENSE`。放在 `vendor/three/`，通过本地import map和相对路径运行，没有CDN。`docs/source-versions.json` 记录NPM完整性值、源tag/commit及逐文件SHA-256；检查脚本验证未被改写。完整署名及许可在 `THIRD_PARTY_NOTICES.md` 和 `vendor/three/LICENSE`，随静态产物交付。

本项目独立实现：受限glTF/GLB读取器、坐标/层级变换展开、几何代理、分离轴判断、最近边界距离、方案数据模型、报告、存档及全部原创程序物件。它们继续采用本仓库MIT许可。

## 有实际用户价值的改进点

仅能“看见生成模型”不足以回答“这一版如何摆放”。本项目把资产预览连接到一个可审阅的小工作流：明确坐标单位、保存文件指纹、反复摆放、解释每条间距提醒、保留两套方案并检查比较参数是否一致，最后导出含每对物件距离与限制的报告。发现远程缓冲、压缩几何或不支持的蒙皮时明确拒绝，不悄悄请求资源或产生貌似正常的尺寸。

这些功能不等于精确网格碰撞或专业空间设计软件：包围矩形可能把凹形物件与枝叶之间的空间保守地判成冲突；材质、动画和复杂格式支持更少；没有真实人体/承重/法规判断。Aholo Lux3D生成、导出选项和账户授权仍待实际账号验证，内置程序资产不冒充其使用证据。

## 验证

行为测试覆盖矩形重叠/接触/正间隙/包含、旋转后实际边界、房间溢出、自定阈值等号、保守提醒的可修复性、不同参数比较提示、存档与来源字段校验、独立报告快照，以及原创内嵌glTF/GLB一致性、层级TRS/单位、交错缓冲步幅、远程URI/压缩拒绝、纹理忽略提示、非法索引、循环、蒙皮、截断和非有限坐标。

构建与静态检查验证本地资产、无网络调用的自有应用代码、本地Three.js映射和未更改的库文件/许可。浏览器最终视觉、拖放与导出由主智能体统一QA；测试没有证明适用所有GLB或所有平台导出。
