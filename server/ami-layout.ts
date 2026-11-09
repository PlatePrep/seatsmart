import { storage } from "./storage";
import { MAIN, PATIO, BALLROOM } from "./ami-images";

// The Chateau Anna Maria — tables read from the OpenTable floor-plan screenshots.
// Boxes are pixel [left, top, right, bottom] on the source image; stored as % of the image.
type Row = [label: string, seats: number, area: string, shape: string, box: [number, number, number, number], group?: string, order?: number];

const ROOMS: { name: string; area: string; image: string; w: number; h: number; tables: Row[] }[] = [
  {
    name: "Main dining", area: "inside", image: MAIN, w: 1496, h: 709,
    tables: [
      ["0", 2, "inside", "square", [290, 38, 347, 110], "front", 0],
      ["1", 2, "inside", "square", [361, 38, 418, 110], "front", 1],
      ["2", 2, "inside", "square", [442, 38, 499, 110], "front", 2],
      ["3", 2, "inside", "square", [507, 38, 564, 110], "front", 3],
      ["4", 2, "inside", "square", [585, 38, 642, 110], "front", 4],
      ["5", 2, "inside", "square", [663, 38, 720, 110], "front", 5],
      ["6", 6, "inside", "round", [742, 58, 858, 174]],
      ["7", 4, "inside", "square", [312, 200, 432, 320]],
      ["8", 4, "inside", "round", [342, 370, 424, 452]],
      ["9", 4, "inside", "square", [312, 474, 432, 594]],
      ["10", 8, "inside", "rect", [485, 241, 558, 415]],
      ["11", 4, "inside", "square", [468, 514, 588, 634]],
      ["12", 4, "inside", "square", [601, 180, 721, 300], "center", 0],
      ["13", 4, "inside", "square", [612, 347, 732, 467], "center", 1],
      ["14", 8, "inside", "rect", [614, 530, 788, 603]],
      ["15", 8, "inside", "rect", [787, 252, 860, 426]],
      ["BAR1", 4, "bar", "rect", [115, 269, 188, 443]],
      ["B1", 1, "bar", "round", [30, 190, 88, 248], "stools-top", 0],
      ["B2", 1, "bar", "round", [88, 190, 146, 248], "stools-top", 1],
      ["B3", 1, "bar", "round", [146, 190, 204, 248], "stools-top", 2],
      ["B4", 1, "bar", "round", [204, 190, 262, 248], "stools-top", 3],
      ["B5", 1, "bar", "round", [204, 252, 262, 310], "stools-side", 0],
      ["B6", 1, "bar", "round", [204, 312, 262, 370], "stools-side", 1],
      ["B7", 1, "bar", "round", [204, 370, 262, 428], "stools-side", 2],
      ["B8", 1, "bar", "round", [204, 427, 262, 485], "stools-side", 3],
      ["B9", 1, "bar", "round", [204, 485, 262, 543], "stools-side", 4],
      ["B10", 1, "bar", "round", [204, 542, 262, 600], "stools-side", 5],
      ["B11", 1, "bar", "round", [35, 280, 93, 338], "stools-left", 0],
      ["B12", 1, "bar", "round", [35, 375, 93, 433], "stools-left", 1],
    ],
  },
  {
    name: "Patio", area: "patio", image: PATIO, w: 1388, h: 667,
    tables: [
      ["20", 6, "patio", "rect", [105, 393, 228, 637]],
      ["21", 6, "patio", "rect", [44, 132, 289, 254]],
      ["22", 4, "patio", "square", [404, 39, 527, 210], "patio-back", 0],
      ["23", 4, "patio", "square", [636, 39, 759, 210], "patio-back", 1],
      ["24", 4, "patio", "square", [894, 39, 1017, 210], "patio-back", 2],
      ["25", 4, "patio", "square", [1125, 39, 1248, 210], "patio-back", 3],
      ["28", 4, "patio", "square", [684, 453, 807, 624], "patio-front", 0],
      ["27", 4, "patio", "square", [950, 453, 1073, 624], "patio-front", 1],
      ["26", 4, "patio", "square", [1194, 453, 1317, 624], "patio-front", 2],
    ],
  },
  {
    name: "Ballroom", area: "ballroom", image: BALLROOM, w: 838, h: 667,
    tables: [
      ["45", 6, "ballroom", "round", [517, 45, 621, 149]],
      ["44", 6, "ballroom", "round", [517, 167, 621, 271]],
      ["43", 6, "ballroom", "round", [517, 291, 621, 395]],
      ["42", 6, "ballroom", "round", [517, 409, 621, 513]],
      ["41", 6, "ballroom", "round", [517, 533, 621, 637]],
      ["53", 4, "ballroom", "square", [238, 31, 304, 123], "ball-top", 0],
      ["54", 4, "ballroom", "square", [351, 33, 417, 125], "ball-top", 1],
      ["52", 6, "ballroom", "rect", [267, 165, 333, 296], "ball-center", 0],
      ["51", 6, "ballroom", "rect", [267, 314, 333, 444], "ball-center", 1],
      ["50", 6, "ballroom", "rect", [247, 490, 378, 556]],
      ["74", 2, "ballroom", "square", [31, 105, 83, 157], "ball-left", 0],
      ["73", 2, "ballroom", "square", [31, 204, 83, 256], "ball-left", 1],
      ["72", 2, "ballroom", "square", [31, 300, 83, 352], "ball-left", 2],
      ["71", 2, "ballroom", "square", [31, 409, 83, 461], "ball-left", 3],
      ["70", 2, "ballroom", "square", [31, 513, 83, 565], "ball-left", 4],
      ["64", 2, "ballroom", "square", [115, 105, 167, 157], "ball-right", 0],
      ["63", 2, "ballroom", "square", [115, 204, 167, 256], "ball-right", 1],
      ["62", 2, "ballroom", "square", [115, 300, 167, 352], "ball-right", 2],
      ["61", 2, "ballroom", "square", [115, 409, 167, 461], "ball-right", 3],
      ["60", 2, "ballroom", "square", [115, 513, 167, 565], "ball-right", 4],
    ],
  },
];

/** Replaces a location's rooms and tables with the Anna Maria layout. */
export function applyAmiLayout(locationId: number) {
  for (const t of storage.listTables(locationId)) storage.deleteTable(t.id);
  for (const r of storage.listRooms(locationId)) storage.deleteRoom(r.id);
  ROOMS.forEach((R, i) => {
    const room = storage.createRoom({ locationId, name: R.name, area: R.area, sortOrder: i, imageData: R.image, imageW: R.w, imageH: R.h });
    for (const [label, capacity, area, shape, [l, t, r, b], group = "", order = 0] of R.tables) {
      storage.createTable({
        locationId, roomId: room.id, label, capacity, area, shape, active: true, mergeGroup: group, mergeOrder: order,
        x: Math.round((l / R.w) * 100), y: Math.round((t / R.h) * 100),
        w: Math.max(1, Math.round(((r - l) / R.w) * 100)), h: Math.max(1, Math.round(((b - t) / R.h) * 100)),
      });
    }
  });
}
