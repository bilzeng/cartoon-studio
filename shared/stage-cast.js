export const castProfiles = {
  standard: { name: "标准", height: 1, shoulders: 1, waist: 1, build: 1, head: 1 },
  lanky: { name: "高挑", height: 1.16, shoulders: .87, waist: .81, build: .83, head: .95, detail: "collar" },
  compact: { name: "矮小", height: .82, shoulders: .88, waist: .93, build: .91, head: 1.12, detail: "cap" },
  lean: { name: "纤瘦", height: .98, shoulders: .82, waist: .76, build: .77, head: .96, detail: "collar" },
  broad: { name: "壮实", height: 1.07, shoulders: 1.35, waist: 1.17, build: 1.24, head: 1.06, detail: "vest" },
  round: { name: "圆润", height: .96, shoulders: 1.19, waist: 1.52, build: 1.25, head: 1.08, detail: "cap" },
  stocky: { name: "矮壮", height: .88, shoulders: 1.27, waist: 1.23, build: 1.18, head: 1.08, detail: "vest" },
  ranger: { name: "高壮", height: 1.15, shoulders: 1.26, waist: 1.12, build: 1.16, head: 1, detail: "collar" },
};

const mixedProfiles = ["lanky", "round", "compact", "broad", "lean", "stocky", "ranger", "standard"];
export const crowdProfile = (choice, index) =>
  choice === "mixed" ? mixedProfiles[index % mixedProfiles.length] : choice;
