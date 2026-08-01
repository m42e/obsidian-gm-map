# GM Map — iPad App Specification (SwiftUI)

This document specifies a native **SwiftUI iPad app** that connects to the GM Map
Obsidian plugin over the local network, renders the player‑safe map, and lets
players pan/zoom, move their own tokens, drop attention pings, measure
distances, and view pictures the DM presents from Obsidian.

The plugin side (server + protocol), including the picture-presentation
extension in §11, is implemented. This spec is the contract the app must follow.

- **Target:** iPadOS 16+ (SwiftUI `Canvas` requires iOS 15; 16 recommended).
- **No authentication.** The server is LAN‑only and trusted.
- **Transport:** one WebSocket for state + HTTP GET requests for map, token, and
  picture images.
- **Source of truth:** the DM's machine. The app is a thin client; it sends
  intents (move token, ping) and renders whatever the server broadcasts.

---

## 1. Connecting

The DM opens a map in Obsidian and clicks **Share to iPad**. A panel shows one or
more URLs of the form `http://<host>:<port>` (default port `3010`) and a **QR
code** encoding the first URL.

The app supports two ways to connect:

1. **Scan QR** (recommended): use `VisionKit`'s `DataScannerViewController` (or
   `AVCaptureSession`) to read the QR. The payload is exactly the base URL
   string, e.g. `http://192.168.1.20:3010`.
2. **Manual entry**: a text field for host and port.

From the base URL `http://<host>:<port>` derive:

- WebSocket URL: `ws://<host>:<port>/ws`
- Image URL: `http://<host>:<port>` + `info.imagePath` (from the `hello` message),
  e.g. `http://192.168.1.20:3010/map/dungeon-1/image`

Persist the last successful base URL in `UserDefaults` and offer a "Reconnect"
button on launch.

### Connection lifecycle / state machine

```
disconnected ──connect──▶ connecting ──open──▶ waiting(hello|idle)
      ▲                        │                      │
      └────────error/close─────┴────── hello ─────────▼
                                                   connected
```

- On socket open, the server immediately sends either a `hello` (a map is being
  shared) or `idle` (nothing shared yet). Show a "Waiting for the DM to share a
  map…" state on `idle`.
- When the DM shares (or switches) a map, the server broadcasts a fresh `hello`.
  Treat **every** `hello` as a full reset: replace map info + snapshot, refetch
  the image, recompute the fog, and re‑fit the viewport.
- On socket close/error, auto‑reconnect with backoff (e.g. 0.5s → 5s). Keep
  rendering the last known state, dimmed, while reconnecting.

---

## 2. Protocol reference

All WebSocket frames are **JSON text**. Messages are tagged unions discriminated
by the `"type"` field. This mirrors `src/server/protocol.ts` exactly — keep them
in sync.

### 2.1 Server → Client

**`hello`** — sent on connect and whenever the shared map changes. Full reset.

```json
{
  "type": "hello",
  "info": {
    "mapId": "dungeon-1",
    "imageWidth": 2048,
    "imageHeight": 1536,
    "imagePath": "/map/dungeon-1/image",
    "feetPerCell": 5,
    "cellSize": 70,
    "gridColor": "#000000",
    "gridLineWidth": 1.5
  },
  "snapshot": {
    "tokens": [ /* NetToken[] */ ],
    "spells": [ /* NetSpell[] */ ],
    "fog":    { /* NetFog */ },
    "gridOverlay": false,
    "pan": { "x": 0, "y": 0 },
    "presentedPicture": {
      "id": "pic_7f8c2a",
      "name": "The Sapphire Wyrm",
      "width": null,
      "height": null,
      "imagePath": "/map/dungeon-1/picture/pic_7f8c2a/image"
    }
  }
}
```

`snapshot.presentedPicture` is optional. When present, fetch it and show it over
the map immediately; this restores the DM's presentation after a reconnect.

**`fog`** — fog reveal changed (grid cell or freeform brush).

```json
{ "type": "fog", "fog": { /* NetFog */ } }
```

**`tokens`** — the player‑visible token list changed (moved/added/removed, or a
token entered/left revealed fog). Always the **complete** filtered list; replace
wholesale.

```json
{ "type": "tokens", "tokens": [ /* NetToken[] */ ] }
```

**`spells`** — the player‑visible spell list changed. Complete list; replace.

```json
{ "type": "spells", "spells": [ /* NetSpell[] */ ] }
```

**`grid`** — grid geometry and/or overlay visibility changed. Carries the full
fog (geometry may have changed) and the overlay flag.

```json
{ "type": "grid", "fog": { /* NetFog */ }, "gridOverlay": true }
```

**`pan`** — the DM nudged the players' focus ("look here"). Optional; the app
should animate to center this image‑space point but the user can still pan
freely afterwards.

```json
{ "type": "pan", "pan": { "x": 980, "y": 640 } }
```

**`ping`** — an attention ping to animate (from any client or the DM).

```json
{ "type": "ping", "ping": { "x": 512, "y": 300, "color": "#ff5252", "createdAt": 1718900000000 } }
```

**`picture`** — the DM selected an image in Obsidian. A picture object means
fetch and present it full-screen; `null` means dismiss it and return to the map.

```json
{
  "type": "picture",
  "picture": {
    "id": "pic_7f8c2a",
    "name": "The Sapphire Wyrm",
    "width": null,
    "height": null,
    "imagePath": "/map/dungeon-1/picture/pic_7f8c2a/image"
  }
}
```

```json
{ "type": "picture", "picture": null }
```

**`idle`** — no map currently shared. Show the waiting state.

```json
{ "type": "idle" }
```

### 2.2 Client → Server

**`moveToken`** — request to move a token. The server **ignores** it unless the
token exists and is `playerControlled`. The server snaps (if grid snap is on) and
clamps to the image, then broadcasts the authoritative position back via
`tokens`. Coordinates are **image pixels**.

```json
{ "type": "moveToken", "id": "tok_ab12cd3", "x": 712.0, "y": 480.0 }
```

**`ping`** — drop an attention ping at an image‑space point. The server adds it
(coloring it with the DM's ping color) and broadcasts a `ping`.

```json
{ "type": "ping", "x": 512.0, "y": 300.0 }
```

> The **measure ruler is entirely client‑side** — it sends nothing.

### 2.3 Data shapes

```
NetToken  { id: String, x: Double, y: Double, radius: Double,
            label: String, color: String, playerControlled: Bool,
            imagePath: String? }

NetSpell  { id: String, shape: "circle"|"cone"|"line"|"cube",
            x: Double, y: Double, size: Double, width: Double?,
            angle: Double, label: String, color: String }

NetFog    { cols: Int, rows: Int, cellSize: Double,
            originX: Double, originY: Double,
            revealed: [Bool], brush: String? }

NetPing   { x: Double, y: Double, color: String, createdAt: Double }

NetMapInfo{ mapId: String, imageWidth: Int, imageHeight: Int,
            imagePath: String, feetPerCell: Double, cellSize: Double,
            gridColor: String, gridLineWidth: Double }

NetPicture { id: String, name: String, width: Int?, height: Int?,
             imagePath: String }

NetSnapshot { tokens: [NetToken], spells: [NetSpell], fog: NetFog,
              gridOverlay: Bool, pan: {x,y}?, presentedPicture: NetPicture? }
```

All coordinates and sizes that touch the map are in **image‑pixel space** unless
stated otherwise. Spell `size`/`width` are in **feet** (convert with `pxPerFoot`,
see §5.4). `angle` is in **radians**, `0 = east`, increasing clockwise (screen y
is down).

---

## 3. Swift models (Codable)

```swift
struct NetToken: Codable, Identifiable, Equatable {
    let id: String
    var x: Double
    var y: Double
    var radius: Double
    var label: String
    var color: String
    var playerControlled: Bool
    var imagePath: String?     // HTTP path to the token picture, if any (§10)
}

struct NetSpell: Codable, Identifiable, Equatable {
    let id: String
    var shape: String          // "circle" | "cone" | "line" | "cube"
    var x: Double
    var y: Double
    var size: Double           // feet
    var width: Double?         // feet (line)
    var angle: Double          // radians
    var label: String
    var color: String
}

struct NetFog: Codable, Equatable {
    var cols: Int
    var rows: Int
    var cellSize: Double
    var originX: Double
    var originY: Double
    var revealed: [Bool]
    var brush: String?         // PNG data URL, white = revealed
}

struct NetPing: Codable, Equatable {
    var x: Double
    var y: Double
    var color: String
    var createdAt: Double      // ms since epoch
}

struct NetMapInfo: Codable, Equatable {
    var mapId: String
    var imageWidth: Int
    var imageHeight: Int
    var imagePath: String
    var feetPerCell: Double
    var cellSize: Double
    var gridColor: String
    var gridLineWidth: Double
}

struct NetPicture: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var width: Int?
    var height: Int?
    var imagePath: String
}

struct NetSnapshot: Codable, Equatable {
    var tokens: [NetToken]
    var spells: [NetSpell]
    var fog: NetFog
    var gridOverlay: Bool
    var pan: CGPointCodable?
    var presentedPicture: NetPicture?
}

struct CGPointCodable: Codable, Equatable { var x: Double; var y: Double }
```

### Decoding the tagged union

```swift
enum ServerMessage {
    case hello(info: NetMapInfo, snapshot: NetSnapshot)
    case fog(NetFog)
    case tokens([NetToken])
    case spells([NetSpell])
    case grid(fog: NetFog, gridOverlay: Bool)
    case pan(CGPointCodable)
    case ping(NetPing)
    case picture(NetPicture?)
    case idle
}

extension ServerMessage {
    init?(json data: Data) {
        struct Probe: Decodable { let type: String }
        let d = JSONDecoder()
        guard let t = try? d.decode(Probe.self, from: data).type else { return nil }
        switch t {
        case "hello":
            struct M: Decodable { let info: NetMapInfo; let snapshot: NetSnapshot }
            guard let m = try? d.decode(M.self, from: data) else { return nil }
            self = .hello(info: m.info, snapshot: m.snapshot)
        case "fog":
            struct M: Decodable { let fog: NetFog }
            guard let m = try? d.decode(M.self, from: data) else { return nil }
            self = .fog(m.fog)
        case "tokens":
            struct M: Decodable { let tokens: [NetToken] }
            guard let m = try? d.decode(M.self, from: data) else { return nil }
            self = .tokens(m.tokens)
        case "spells":
            struct M: Decodable { let spells: [NetSpell] }
            guard let m = try? d.decode(M.self, from: data) else { return nil }
            self = .spells(m.spells)
        case "grid":
            struct M: Decodable { let fog: NetFog; let gridOverlay: Bool }
            guard let m = try? d.decode(M.self, from: data) else { return nil }
            self = .grid(fog: m.fog, gridOverlay: m.gridOverlay)
        case "pan":
            struct M: Decodable { let pan: CGPointCodable }
            guard let m = try? d.decode(M.self, from: data) else { return nil }
            self = .pan(m.pan)
        case "ping":
            struct M: Decodable { let ping: NetPing }
            guard let m = try? d.decode(M.self, from: data) else { return nil }
            self = .ping(m.ping)
        case "picture":
          struct M: Decodable { let picture: NetPicture? }
          guard let m = try? d.decode(M.self, from: data) else { return nil }
          self = .picture(m.picture)
        case "idle":
            self = .idle
        default:
            return nil
        }
    }
}

enum ClientMessage: Encodable {
    case moveToken(id: String, x: Double, y: Double)
    case ping(x: Double, y: Double)

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .moveToken(id, x, y):
            try c.encode("moveToken", forKey: .type)
            try c.encode(id, forKey: .id)
            try c.encode(x, forKey: .x); try c.encode(y, forKey: .y)
        case let .ping(x, y):
            try c.encode("ping", forKey: .type)
            try c.encode(x, forKey: .x); try c.encode(y, forKey: .y)
        }
    }
    enum CodingKeys: String, CodingKey { case type, id, x, y }
}
```

---

## 4. Networking

Use `URLSessionWebSocketTask` (no third‑party libraries).

```swift
@MainActor
final class MapClient: ObservableObject {
    @Published var info: NetMapInfo?
    @Published var tokens: [NetToken] = []
    @Published var spells: [NetSpell] = []
    @Published var fog: NetFog?
    @Published var gridOverlay = false
    @Published var image: UIImage?
    @Published var presentedPicture: NetPicture?
    @Published var presentedImage: UIImage?
    @Published var connection: ConnectionState = .disconnected
    @Published private(set) var pings: [NetPing] = []   // transient

    private var task: URLSessionWebSocketTask?
    private var baseURL: URL?

    func connect(base: URL) { /* open ws://host:port/ws, start receive loop */ }
    func receiveLoop() { /* task.receive { ... decode ServerMessage ... apply } */ }
    func send(_ msg: ClientMessage) { /* JSON-encode, task.send(.string(...)) */ }
}
```

Apply messages on the main actor:

- `hello`: set `info`, replace all state from `snapshot`, then **fetch the image**
  from `base + info.imagePath` (`URLSession.shared.data(from:)` → `UIImage`), then
  recompute the fog mask (§5.3) and fit the viewport (§5.1).
- `fog` / `grid`: replace `fog` (and `gridOverlay`), recompute the fog mask.
- `tokens` / `spells`: replace arrays. (See §6.3 for reconciling a token you are
  actively dragging.)
- `pan`: animate the viewport to center the point.
- `ping`: append to `pings`; prune entries older than 3000 ms; keep an animation
  timer running while any ping is active.
- `picture`: replace `presentedPicture`. For a non-null value, clear the previous
  `presentedImage` and fetch `base + picture.imagePath`; for `null`, clear both
  fields and reveal the unchanged map.
- `idle`: clear `info`, map image, and presented picture; show the waiting screen.

On `hello`, apply `snapshot.presentedPicture` in the same way as a `picture`
message. Guard asynchronous picture fetches by ID: only install the decoded
image if its ID still equals `presentedPicture?.id`, because the DM can replace
or dismiss it while the HTTP request is in flight.

The image must be fetched **after** each `hello` because the map can change. Add a
cache‑buster only if you cache (`Cache-Control: no-store` is already set server
side).

---

## 5. Rendering (SwiftUI `Canvas`)

Render order (matches the plugin's `MapRenderer`):

```
1. base image
2. fog of war (opaque)
3. grid overlay (if gridOverlay)
4. spell templates
5. tokens
6. attention pings (screen space, constant size)
7. (overlay) measure ruler, if active
```

Use a single `Canvas { ctx, size in … }` (or `TimelineView(.animation)` wrapping
it so pings animate). Drive continuous animation only while pings are active to
save power.

### 5.1 Viewport (port of `src/render/Viewport.ts`)

```swift
struct Viewport {
    var scale: Double = 1
    var offset: CGPoint = .zero      // screen-space pixels
    let imageSize: CGSize
    let minScale = 0.05, maxScale = 8.0

    func toScreen(_ p: CGPoint) -> CGPoint {
        CGPoint(x: p.x * scale + offset.x, y: p.y * scale + offset.y)
    }
    func toImage(_ p: CGPoint) -> CGPoint {
        CGPoint(x: (p.x - offset.x) / scale, y: (p.y - offset.y) / scale)
    }
    mutating func pan(by d: CGSize) { offset.x += d.width; offset.y += d.height }

    mutating func zoom(by factor: Double, anchor: CGPoint) {
        let next = min(maxScale, max(minScale, scale * factor))
        let ratio = next / scale
        offset.x = anchor.x - (anchor.x - offset.x) * ratio
        offset.y = anchor.y - (anchor.y - offset.y) * ratio
        scale = next
    }
    mutating func fit(in view: CGSize) {
        guard imageSize.width > 0, imageSize.height > 0 else { return }
        let s = min(view.width / imageSize.width, view.height / imageSize.height)
        scale = min(maxScale, max(minScale, s))
        offset = CGPoint(x: (view.width  - imageSize.width  * scale) / 2,
                         y: (view.height - imageSize.height * scale) / 2)
    }
}
```

`Canvas` uses point units; gesture locations are already in points, so no
device‑pixel‑ratio handling is needed (unlike the plugin's canvas).

Apply the transform once and draw in image space:

```swift
ctx.translateBy(x: vp.offset.x, y: vp.offset.y)
ctx.scaleBy(x: vp.scale, y: vp.scale)
// now draw the image at (0,0) and everything in image-space
```

(For screen‑space layers like pings, draw before applying the transform, or
reset/compute screen coordinates with `vp.toScreen`.)

### 5.2 Base image

Draw the `UIImage` at image‑space origin, sized `imageWidth × imageHeight`.

### 5.3 Fog of war (port of `src/fog/FogLayer.ts`)

The player view is **fully opaque** fog with revealed areas cut out. Precompute a
fog `UIImage` whenever `fog` changes (not every frame), then draw it transformed.

The mask combines two reveal sources (white = revealed):

1. **Grid cells:** for `row in 0..<rows`, `col in 0..<cols`, if
   `revealed[row*cols + col]` is true, the cell rect is
   `(originX + col*cellSize, originY + row*cellSize, cellSize, cellSize)`.
2. **Brush:** decode `fog.brush` (a `data:image/png;base64,…` URL) into a
   `UIImage` sized `imageWidth × imageHeight`; its alpha marks revealed pixels.

Build the fog image with `UIGraphicsImageRenderer` at `imageWidth × imageHeight`:

```swift
let r = UIGraphicsImageRenderer(size: CGSize(width: W, height: H))
let fogImage = r.image { c in
    let cg = c.cgContext
    cg.setFillColor(UIColor.black.cgColor)
    cg.fill(CGRect(x: 0, y: 0, width: W, height: H))
    cg.setBlendMode(.destinationOut)        // erase = reveal
    // grid cells
    cg.setFillColor(UIColor.white.cgColor)
    for row in 0..<rows { for col in 0..<cols where revealed[row*cols+col] {
        cg.fill(CGRect(x: originX + Double(col)*cellSize,
                       y: originY + Double(row)*cellSize,
                       width: cellSize, height: cellSize))
    }}
    // brush (white-with-alpha PNG): erase where painted
    brushImage?.draw(in: CGRect(x: 0, y: 0, width: W, height: H))
}
```

Then each frame draw `fogImage` in image space (it already lines up 1:1 with the
image). Disable interpolation so cells stay crisp:
`ctx.withCGContext { $0.interpolationQuality = .none }` (or draw with
`.interpolation(.none)` on the `GraphicsContext.draw`).

> Decoding base64: strip the `data:image/png;base64,` prefix, `Data(base64Encoded:)`,
> `UIImage(data:)`. Recompute only when `fog.brush` changes (compare to the last
> decoded string).

### 5.4 Grid overlay (port of `FogLayer.renderGridOverlay`)

Only when `gridOverlay == true`. Clip to the image rect, then stroke vertical
lines at `originX + c*cellSize` for `c in 0...cols` and horizontal lines at
`originY + r*cellSize` for `r in 0...rows`. Use color `info.gridColor` and width
`info.gridLineWidth / scale` (so the on‑screen width is constant).

### 5.5 Spell templates (port of `src/spells/SpellLayer.ts`)

`pxPerFoot = info.cellSize / max(1, info.feetPerCell)` — but prefer the **live**
fog cellSize if you track it (the DM can rescale the grid): use
`fog.cellSize / feetPerCell`. Let `size = spell.size * pxPerFoot`,
`d = (cos angle, sin angle)`, `p = (-d.y, d.x)` (perpendicular). Fill at 25%
opacity, stroke solid, both in `spell.color`.

- **circle:** disc center `(x, y)`, radius `size`.
- **cone:** triangle `[(x,y), base + p*size/2, base - p*size/2]` where
  `base = (x,y) + d*size`. (Width at the far end equals the length.)
- **line:** rectangle of length `size` and width `spell.width*pxPerFoot`,
  centered on the axis from `(x,y)` along `d`.
- **cube:** square of side `size` with `(x,y)` on the near face, extending along
  `d`.

Players never rotate/edit spells; just draw them. Optionally draw the label at
the origin.

### 5.6 Tokens (port of `src/tokens/TokenLayer.ts`)

For each token (screen center `vp.toScreen(x,y)`, screen radius `radius*scale`):

- If `token.imagePath != nil` and its picture is loaded (§10), clip to the token
  circle and draw the image scaled to **cover** (center-crop), then stroke the
  border. Otherwise draw a filled circle in `token.color` and the initial letter
  as below.
- Filled circle in `token.color`; stroke `rgba(0,0,0,0.6)` width 2 (width 3 white
  if it's the one being dragged).
- White uppercased first character of `label` (fallback `?`) centered, font
  `max(8, screenRadius)` — **only when there is no picture**.
- If `label` non‑empty, draw it in a translucent black rounded box just below the
  token (whether or not it has a picture).

Player mode shows no hidden/▦ indicators (those are DM‑only). Every token the app
receives should be drawn (the server already filtered them).

### 5.7 Pings (port of `src/pings/PingLayer.ts`)

Draw in **screen space** at constant size, anchored to the image point via
`vp.toScreen`. Constants:

```
PING_DURATION_MS = 3000, RINGS = 3, RING_PERIOD_MS = 900,
MIN_RADIUS = 5, MAX_RADIUS = 34, FADE_OUT_MS = 600, DOT_RADIUS = 4
```

For `age = now - createdAt` (use wall clock ms), skip if `age < 0 || age >= 3000`.
`fade = age > 3000-600 ? max(0,(3000-age)/600) : 1`. For each ring `i in 0..<3`:
`phase = ((age/900) + i/3).truncatingRemainder(1)`,
`radius = 5 + 29*phase`, `alpha = (1-phase)*fade`. Stroke a dark halo
(`rgba(0,0,0,0.8)`, width 4, alpha`*0.5`) then the colored ring (width 2.5). Draw
a center dot of radius 4. Animate via `TimelineView(.animation)` while any ping is
active.

---

## 6. Interaction

Use SwiftUI gestures on the `Canvas`. Keep one source of truth for `Viewport` in
`@State`/the view model.

### 6.1 Pan & zoom

- **Zoom:** `MagnificationGesture`. Track the gesture's start scale; on change,
  apply `vp.zoom(by: newMagnification/lastMagnification, anchor: pinchMidpoint)`.
  If you can't get the pinch midpoint from SwiftUI easily, zoom toward the view
  center, or host the canvas in a `UIViewRepresentable` and use
  `UIPinchGestureRecognizer` (`location(in:)` gives the anchor).
- **Pan:** `DragGesture(minimumDistance: 0)` when the drag did **not** start on a
  player‑controlled token (see §6.2). Apply incremental translation to
  `vp.offset`.
- Combine with `.simultaneousGesture` so pinch + drag work together.

### 6.2 Move a player token

On drag start, hit‑test in image space, topmost first, **only** player‑controlled
tokens:

```swift
let p = vp.toImage(startLocation)
let hit = tokens.last(where: { $0.playerControlled &&
    hypot(p.x - $0.x, p.y - $0.y) <= $0.radius })
```

- If `hit != nil`: enter **token‑drag** mode. On each change, set the token's
  local `x,y` to `vp.toImage(currentLocation)` (optimistic), and throttle
  `client.send(.moveToken(id:hit.id, x:, y:))` to ~20–30 Hz. On end, send a final
  `moveToken`.
- If `hit == nil`: pan the map (§6.1).

This is a "pick up where I touched" drag. (Optional refinement: keep the grab
offset between the touch and the token center so the token doesn't jump.)

### 6.3 Reconciling server token updates while dragging

The server snaps/clamps and echoes the authoritative position via `tokens`.
While the user is actively dragging token `id`, **ignore** incoming position
changes for that `id` (keep the local optimistic position). When the drag ends,
accept the next server `tokens` message as truth (it will contain the snapped
position). A simple approach: store `draggingTokenID`; when applying a `tokens`
message, for that id keep the local copy until `draggingTokenID == nil`.

### 6.4 Drop a ping

`SpatialTapGesture` (or a tap recognizer) → `let p = vp.toImage(location)` →
`client.send(.ping(x: p.x, y: p.y))`. Don't add the ping locally; it will arrive
via the `ping` broadcast (keeps all clients identical). Distinguish tap from
drag by minimum distance / gesture priority.

### 6.5 DM "look here" recenter

On a `pan` message, animate the viewport so the point is centered:
`offset = viewCenter - point*scale` (animate with `withAnimation`). The user can
still pan/zoom afterward; do not lock the view.

### 6.6 Measure ruler (client‑only)

A toolbar toggle enters **ruler mode**. A `DragGesture` then defines a segment
from start to current image points. Draw the line + endpoints, and a label with
the distance:

```
feet = (hypot(dxImage, dyImage) / fog.cellSize) * info.feetPerCell
```

Optionally snap endpoints to grid intersections and show cells too. Sends
nothing. Exiting ruler mode clears the segment.

---

## 7. Suggested project structure

```
GmMapPlayer/
  App/
    GmMapPlayerApp.swift          // @main, root scene
    ContentView.swift             // connection gate -> MapScreen
  Connection/
    ConnectionView.swift          // QR scan + manual host/port
    QRScannerView.swift           // VisionKit DataScanner wrapper
  Net/
    MapClient.swift               // URLSessionWebSocketTask + image fetch
    Protocol.swift                // ServerMessage/ClientMessage + decode
    Models.swift                  // NetToken/NetSpell/NetFog/...
  Map/
    MapScreen.swift               // Canvas + gestures + toolbar
    PresentedPictureView.swift     // DM-controlled full-screen image viewer
    Viewport.swift                // coordinate transforms
    FogRenderer.swift             // builds the fog UIImage from NetFog
    SpellGeometry.swift           // shape outlines (port of SpellLayer.geometry)
    Drawing.swift                 // token/spell/ping/grid draw helpers
    RulerState.swift              // measure tool
  Resources/ ...
```

State ownership: a single `@StateObject MapClient` holds network state; `MapScreen`
owns the `Viewport` and interaction/UI state (`draggingTokenID`, ruler, tool).

---

## 8. Testing checklist

Before the app exists you can exercise the server with a CLI (`npm i -g wscat`):

- `wscat -c "ws://<host>:3010/ws"` → expect a `hello` (or `idle`). Verify the
  frame contains **no** markers, no hidden tokens, no invisible spells.
- `curl -o map.png "http://<host>:3010/map/<id>/image"` → the image bytes.
- Send `{"type":"ping","x":100,"y":100}` → a ping appears on the DM map.
- Send `{"type":"moveToken","id":"<non-player-token>","x":0,"y":0}` → **ignored**.
  Send it for a player‑controlled token → the DM map moves it (snapped).

For the app:

1. Scan QR → connects; image + fog + tokens render and match the DM view.
2. Pinch‑zoom and drag‑pan are smooth; grid overlay toggles with the DM.
3. Dragging a player token moves it on the DM screen; releasing snaps it; a
   non‑player token cannot be dragged (it pans instead).
4. Tap drops a ping visible on the DM map and the iPad.
5. Reveal/hide fog on the DM → the iPad updates; tokens entering fog disappear.
6. Reveal a spell on the DM → it appears on the iPad; hide → it disappears.
7. Ruler measures the same distance as a known map feature.
8. DM "Pan player view" → the iPad recenters but can still be panned.
9. Kill/restore WiFi → the app reconnects and re‑syncs.
10. A token with a picture (DM set an `image`) renders the photo clipped to its
    circle; a token without one still renders the colored circle + initial.
    Fetch `http://<host>:3010/map/<id>/token/<tokenId>/image` → the token bytes;
    a non‑player, fogged token's id returns **404** (art is not leaked).
11. In Obsidian, right-click an ordinary image and choose **Show on iPad**. The
    image replaces the map on connected clients without editing the image or
    map note. **Hide picture on iPad** returns every client to the map.

---

## 9. Notes & gotchas

- **Coordinate space:** everything map‑related is image pixels. Convert touches
  with `Viewport.toImage`; send token/ping coordinates in image pixels.
- **Full‑list replacement:** `tokens`/`spells`/`fog` messages are authoritative
  full snapshots, not diffs. Replace, don't merge.
- **Fog is opaque** for players; tokens draw on top of fog, which is exactly why
  the server omits tokens in unrevealed areas — don't try to re‑add them.
- **Brush decode cost:** only rebuild the fog image when `fog` actually changes;
  cache the decoded brush `UIImage` keyed by the data‑URL string.
- **Wall clock for pings:** `createdAt` is server `Date.now()` (ms). Use device
  time for the animation; small clock skew is visually harmless over 3 s.
- **Angles:** radians, `0 = east`, clockwise (screen y down). Spell `width` and
  `size` are feet.
- **No security:** anyone on the LAN can connect and move player tokens. This is
  intended. Do not expose the port beyond the local network.
- **Image content types** served: png/jpeg/webp/gif/svg/bmp. `UIImage(data:)`
  handles the common ones; if you ship SVG maps, render via other means.
- **Token pictures** are optional and fetched lazily over HTTP (see §10). A token
  without `imagePath` renders exactly as before. Cache decoded token images by
  `imagePath`; the same path always maps to the same picture for a given map.
- **Presented pictures are DM-controlled.** Keep the map state and viewport in
  memory underneath the picture so dismissal returns to exactly the same view.

---

## 10. Protocol extension: token pictures

The DM may give a token a **picture** instead of a flat color. This is a
backward‑compatible addition: clients that ignore the new field keep working and
just draw colored circles.

### 10.1 Wire change

`NetToken` gains one optional field:

```json
{
  "id": "tok_ab12cd3",
  "x": 712.0, "y": 480.0, "radius": 30.0,
  "label": "Goblin", "color": "#c0392b",
  "playerControlled": false,
  "imagePath": "/map/dungeon-1/token/tok_ab12cd3/image"
}
```

- `imagePath` (`String?`) — an HTTP path, relative to the server root, that
  serves the token's picture bytes. **Absent / null** when the token has no
  picture (draw the colored circle + initial as before).
- It appears anywhere a `NetToken` does: the `hello` snapshot and every `tokens`
  message. Like all token data it is a full‑list replacement, not a diff.
- The path is stable for a `(mapId, tokenId)` pair, but the **picture behind it
  can change** (the DM can swap a token's image). Treat a fresh `hello` as a
  reason to drop cached token images (a new map may reuse token ids).

### 10.2 Fetching the image

GET `base + imagePath`, e.g. `http://192.168.1.20:3010/map/dungeon-1/token/tok_ab12cd3/image`.

- Same host/port as the map image. Response is raw image bytes with a
  `Content-Type` of png/jpeg/webp/gif/svg/bmp and `Cache-Control: no-store`.
- Decode with `URLSession.shared.data(from:)` → `UIImage(data:)`.
- **Cache** the decoded `UIImage` keyed by the full `imagePath` string. Fetch a
  path at most once per `hello`; reuse the cached image across `tokens` updates.
- A `404` means the token has no servable picture (e.g. it just lost player
  visibility). Fall back to the colored circle; do not retry in a tight loop.

### 10.3 Security note

The server only serves a token image when that token is **player‑visible**
(player‑controlled, or visible and currently in revealed fog) — the same filter
that decides whether the token appears on the wire at all. Probing a hidden or
DM‑only token id returns `404`, so DM token art never leaks. No `imagePath` is
ever emitted for tokens the player can't see.

### 10.4 Rendering

When a token has a loaded picture, draw it **clipped to the token circle**,
scaled to **cover** (center‑crop) the `2*radius` square, then stroke the usual
border (white width 3 while dragging, else `rgba(0,0,0,0.6)` width 2). Skip the
initial letter. Keep the label box below the token. While the image is still
loading (or on `404`), render the colored‑circle fallback so tokens never pop in
blank.

```swift
if let img = tokenImageCache[token.imagePath ?? ""] {
    ctx.clip(to: Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r,
                                        width: 2*r, height: 2*r)))
    // draw img with a cover (max) scale, centered on c, then reset clip
} else {
    // colored circle + initial (existing behavior)
}
```

---

## 11. Protocol extension: DM-presented pictures

After sharing a map, the DM can right-click any supported image in Obsidian and
choose **Show on iPad**. This does not modify the image, require an embed in the
map note, or require frontmatter, tags, filename conventions, or GM Map syntax.
It is a temporary DM-controlled presentation over the existing map session.

The context-menu action supports png, jpeg/jpg, webp, gif, svg, and bmp files.
The plugin assigns the selected file a new opaque ID and exposes it only at:

```
/map/<mapId>/picture/<pictureId>/image
```

The WebSocket broadcast contains only player-safe metadata:

```json
{
  "id": "pic_7f8c2a",
  "name": "The Sapphire Wyrm",
  "width": 1600,
  "height": 900,
  "imagePath": "/map/dungeon-1/picture/pic_7f8c2a/image"
}
```

The vault path is never sent. The HTTP route validates the opaque ID against the
single picture currently presented by the active map session. It returns `404`
for an old, invented, dismissed, or different-map ID and serves valid requests
with the source `Content-Type` and `Cache-Control: no-store`.

### 11.1 Wire and reconnect behavior

The shared wire model is:

```ts
export interface NetPicture {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  imagePath: string;
}
```

`{ type: "picture", picture: NetPicture }` presents or replaces the image;
`{ type: "picture", picture: null }` dismisses it. The active `NetPicture` is
also included as optional `hello.snapshot.presentedPicture`, so a newly
connected or reconnected client enters the same presentation. It is ephemeral:
sharing a different map or unsharing clears it.

Clients that do not recognize the new message ignore it and remain on the map.
No map-state persistence changes are required.

### 11.2 Obsidian experience

- **Show:** right-click a supported image file, link, or file-backed embed and
  choose **Show on iPad**. A notice confirms how many clients received it.
- **Replace:** invoke **Show on iPad** on another image; the new image replaces
  the previous one immediately and the old HTTP URL becomes invalid.
- **Hide:** right-click the currently shown image and choose **Hide from iPad**,
  or run **GM Map: Hide picture on iPad** from the command palette.
- A map must already be shared. Otherwise the plugin shows a notice asking the
  DM to share a map first.

### 11.3 iPad experience

Present the fetched picture above the whole map UI on a neutral background,
aspect-fit by default. Keep the map view alive underneath it. Allow pinch zoom,
drag pan while zoomed, and double-tap to toggle between fit and a readable zoom.
The presentation is controlled by the DM, so do not add a local close button.

Show a centered progress indicator while loading. On an HTTP or decode failure,
show the picture name and a compact retry action, but continue listening so a
replacement or dismissal takes effect. When `picture` becomes `null`, remove
the viewer and reveal the map with its previous viewport and interaction state.

### 11.4 Acceptance checks

1. Share a map, right-click an unrelated vault image, choose **Show on iPad**,
  and verify it appears without changing that image or the map note.
2. Present a second image and verify it immediately replaces the first; the old
  image URL now returns `404`.
3. Dismiss through the image menu and through the command palette; each returns
  clients to their unchanged map viewport.
4. Present an image with no client connected, then connect: the `hello` snapshot
  restores the picture.
5. An invented picture ID, a dismissed ID, and any ID after unsharing return
  `404`.
