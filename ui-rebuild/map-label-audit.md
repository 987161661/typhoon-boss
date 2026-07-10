# Boss 图鉴地图缩放审计

## 截图中的根因

`trackViewBox()` 会把极短路径压到最小 `72 × 36` 个地图单位；在约 1,560px 宽的地图容器里，这意味着横向放大约 20 倍。SVG 的 `viewBox` 会同时放大所有以地图单位写死的内容：`r="8"/"7"` 的出生与终止点、登陆菱形的 `7/9/11` 偏移、`10px` SVG 文字、`2.5/8` 的路线描边和 `stdDeviation="3"` 的光晕。因此截图里的 LAND、SPAWN、圆点、菱形和红色路线都异常粗大，并不是单独的 CSS 字号问题。

另有一层 `.atlas-route-caption` 是绝对定位的 HTML 覆盖物，不在 SVG 坐标系和 `viewBox` 变换中；它不能随地理取景移动或缩放，容易遮住路径与标记。

## 坐标与缩放安全的布局方案

1. 继续以路径与风圈 bounds 计算地理取景，但同时返回 `{ x, y, width, height }`，不要只返回字符串。bounds 还要并入每个标记的文字外接安全区（起止点约 `+/- 18`、LAND 标签约 `+/- 30` 个**屏幕像素等价的地图单位**），防止取景边缘裁字。
2. 路径、风圈、所有出生/终止/登陆点与其文字必须放进同一个 SVG `<g class="atlas-map-layer">`；地理位置全部仍使用 `project()` 得到的同一套 `0..1000 × 0..500` 坐标。不要把地理标签放在 HTML 绝对定位层。
3. 根据实际 SVG 的 `clientWidth/clientHeight` 与当前 viewBox 求 `screenScale = min(clientWidth / width, clientHeight / height)`（默认 `preserveAspectRatio="xMidYMid meet"`）。将想要的屏幕视觉尺寸换回地图单位：`mapUnit = targetPx / screenScale`。
   - 例如端点半径 `8px / screenScale`、文字 `10px / screenScale`、标签偏移 `12px / screenScale`、线路 `2.5px / screenScale`、光晕 `3px / screenScale`。
   - 这样它们的**位置**完整跟随地图的缩放和平移，且点、字、路线在强放大时不会变成截图里的巨物；缩小到全局时也不会小到看不清。
4. 将说明文字明确区分为 HUD 与地理标记：`WORLD TRACK`、Boss 名称、统计信息保留为屏幕固定 HUD，但应避让路径（例如固定左下、设最大宽度和半透明底）；SPAWN / END / LAND 则是地理标记，必须在 SVG map layer 内。
5. 若采用 CSS `vector-effect="non-scaling-stroke"`，只能给路线和海岸线描边用；它不能解决圆点、文字、标签间距和滤镜，仍需上述 `mapUnit` 尺寸换算。不要把它当作完整缩放方案。

## 验收

- 任意短路径取景时，LAND/SPAWN/END 与路线都落在正确经纬度，且标签不会被裁剪。
- 地图从全局缩到局部时，路径几何与风圈占据主要画面；标记、文字、描边视觉上保持可读且不会压住主体。
- 切换台风与窗口尺寸变化后重算 `screenScale`，不残留上一个条目的尺寸或坐标。
