import { check, string } from "../../../server/errors.mjs";
import { canonicalDrugName } from "../../../server/medical/med-safety.mjs";

const normalizeName = (value) => String(value || "").trim().toLowerCase();

// Known adverse-reaction profiles for frequently used drug groups, keyed by
// canonical-name substrings. This is a screening aid built from common
// clinical knowledge — not a substitute for the label or pharmacovigilance
// databases; causality should be assessed with the Naranjo scale.
export const ADR_PROFILES = [
  { pattern: "普利", drugClass: "ACEI", reactions: ["干咳", "高钾血症", "血钾升高", "血钾偏高", "血肌酐升高", "血肌酐偏高", "肾功能恶化", "血管性水肿"], monitoring: ["血钾", "血肌酐"] },
  { pattern: "沙坦", drugClass: "ARB", reactions: ["高钾血症", "血钾升高", "血肌酐升高", "头晕"], monitoring: ["血钾", "血肌酐"] },
  { pattern: "地平", drugClass: "CCB", reactions: ["踝部水肿", "面部潮红", "头痛", "牙龈增生"], monitoring: ["血压"] },
  { pattern: "美托洛尔", drugClass: "β受体阻滞剂", reactions: ["心动过缓", "乏力", "支气管痉挛"], monitoring: ["心率"] },
  { pattern: "他汀", drugClass: "他汀类", reactions: ["肌痛", "肌无力", "横纹肌溶解", "转氨酶升高", "肝功能异常"], monitoring: ["肌酸激酶 CK", "肝功能"] },
  { pattern: "二甲双胍", drugClass: "双胍类", reactions: ["恶心", "腹泻", "乳酸酸中毒", "维生素b12缺乏"], monitoring: ["肾功能", "维生素 B12"] },
  { pattern: "列净", drugClass: "SGLT2抑制剂", reactions: ["泌尿系感染", "外阴阴道炎", "酮症酸中毒", "脱水"], monitoring: ["酮体", "血糖"] },
  { pattern: "列汀", drugClass: "DPP-4抑制剂", reactions: ["鼻咽炎", "胰腺炎"], monitoring: ["淀粉酶"] },
  { pattern: "呋塞米", drugClass: "袢利尿剂", reactions: ["低钾血症", "血钾降低", "低钠血症", "耳毒性", "高尿酸"], monitoring: ["电解质", "听力"] },
  { pattern: "螺内酯", drugClass: "醛固酮拮抗剂", reactions: ["高钾血症", "血钾升高", "男性乳房发育"], monitoring: ["血钾"] },
  { pattern: "地高辛", drugClass: "洋地黄类", reactions: ["恶心", "黄视", "绿视", "心律失常", "心动过缓"], monitoring: ["地高辛浓度", "血钾"] },
  { pattern: "华法林", drugClass: "维生素K拮抗剂", reactions: ["出血", "牙龈出血", "皮下瘀斑", "inr升高"], monitoring: ["INR"] },
  { pattern: "利伐沙班", drugClass: "Xa因子抑制剂", reactions: ["出血", "消化道出血"], monitoring: ["血红蛋白"] },
  { pattern: "胺碘酮", drugClass: "胺碘酮", reactions: ["甲状腺功能异常", "肺纤维化", "咳嗽", "qt延长", "心动过缓", "角膜色素沉着"], monitoring: ["甲状腺功能", "胸片/肺功能", "心电图 QT"] },
  { pattern: "奥美拉唑", drugClass: "质子泵抑制剂", reactions: ["头痛", "腹泻", "低镁血症", "维生素b12缺乏", "骨折风险增加"], monitoring: ["血镁"] },
  { pattern: "阿司匹林", drugClass: "抗血小板", reactions: ["上腹不适", "黑便", "消化道出血", "过敏", "哮喘发作"], monitoring: ["血红蛋白", "大便潜血"] },
  { pattern: "氯吡格雷", drugClass: "抗血小板", reactions: ["出血", "消化道出血", "皮疹"], monitoring: ["血红蛋白"] },
  { pattern: "泼尼松", drugClass: "糖皮质激素", reactions: ["血糖升高", "向心性肥胖", "骨质疏松", "感染风险增加", "消化道溃疡"], monitoring: ["血糖", "骨密度（长期）"] },
  { pattern: "氟西汀", drugClass: "SSRI", reactions: ["恶心", "失眠", "qt延长", "5-羟色胺综合征"], monitoring: ["心电图"] },
  { pattern: "克拉霉素", drugClass: "大环内酯类", reactions: ["恶心", "qt延长", "肝功能异常", "味觉异常"], monitoring: ["心电图", "肝功能"] },
  { pattern: "左氧氟沙星", drugClass: "喹诺酮类", reactions: ["肌腱炎", "跟腱疼痛", "跟腱断裂", "qt延长", "失眠", "血糖波动"], monitoring: ["心电图", "肌腱症状"] },
  { pattern: "头孢", drugClass: "头孢菌素类", reactions: ["过敏", "皮疹", "腹泻", "双硫仑样反应"], monitoring: ["过敏史询问"] },
  { pattern: "青霉素", drugClass: "青霉素类", reactions: ["过敏性休克", "皮疹", "过敏"], monitoring: ["皮试"] },
  { pattern: "异烟肼", drugClass: "抗结核", reactions: ["肝功能异常", "转氨酶升高", "周围神经病变"], monitoring: ["肝功能"] },
  { pattern: "利福平", drugClass: "抗结核", reactions: ["肝功能异常", "转氨酶升高", "体液橙染"], monitoring: ["肝功能"] },
  { pattern: "碳酸锂", drugClass: "心境稳定剂", reactions: ["震颤", "锂中毒", "口渴", "多尿", "甲状腺功能异常"], monitoring: ["血锂浓度", "甲状腺功能"] },
  { pattern: "甲氨蝶呤", drugClass: "抗代谢类", reactions: ["口腔溃疡", "骨髓抑制", "肝功能异常", "肺纤维化"], monitoring: ["血常规", "肝功能"] },
];

// Match presented findings against known reaction keywords for the patient's
// medications. Screening only — causality needs the Naranjo workup.
export function assessAdverseReaction({ medications = [], findings = "" } = {}) {
  const entries = medications
    .map((med) => (typeof med === "string" ? med : med?.name))
    .filter((name) => typeof name === "string" && name.trim())
    .map((raw) => ({ raw, canonical: canonicalDrugName(raw) }));
  check(entries.length >= 1, "INVALID_INPUT", "请提供至少 1 种当前用药");
  check(
    entries.length <= 60,
    "INVALID_INPUT",
    "用药清单最多 60 条",
  );
  const findingsText = string(findings, "临床表现", 3000);
  const lowerFindings = findingsText.toLowerCase();
  const suspected = [];
  const profiles = [];
  const seenProfiles = new Set();
  for (const entry of entries) {
    for (const profile of ADR_PROFILES) {
      if (!entry.canonical.includes(profile.pattern) && !normalizeName(entry.raw).includes(profile.pattern))
        continue;
      const key = profile.pattern;
      if (!seenProfiles.has(key)) {
        seenProfiles.add(key);
        profiles.push({
          drugClass: profile.drugClass,
          matchedMedications: entries
            .filter((e) => e.canonical.includes(profile.pattern))
            .map((e) => e.raw),
          knownReactions: profile.reactions,
          monitoring: profile.monitoring,
        });
      }
      for (const reaction of profile.reactions)
        if (lowerFindings.includes(reaction.toLowerCase()))
          suspected.push({
            medication: entry.raw,
            drugClass: profile.drugClass,
            reaction,
            message: `「${entry.raw}」（${profile.drugClass}）已知不良反应包含「${reaction}」，与临床表现相符，建议核查。`,
            monitoring: profile.monitoring,
          });
    }
  }
  const distinctSuspected = [];
  const seen = new Set();
  for (const item of suspected) {
    const key = `${item.medication}:${item.reaction}`;
    if (!seen.has(key)) {
      seen.add(key);
      distinctSuspected.push(item);
    }
  }
  return {
    findings: findingsText,
    suspected: distinctSuspected,
    drugProfiles: profiles,
    total: distinctSuspected.length,
    note: "不良反应筛查为提示性结果，不构成因果判定；请用 Naranjo 量表评估因果关系并按说明书/药物警戒数据库核实。",
  };
}


export function adverseReactionTool() {
  return {
    definition: {
      type: "function",
      function: {
        name: "assess_adverse_reaction",
        description:
          "把当前用药清单与临床表现做匹配，筛查可能的药物不良反应（内置常见药组知识表）。提示性筛查，非因果判定。",
        parameters: {
          type: "object",
          properties: {
            medications: { type: "array", items: { type: "string" } },
            findings: { type: "string" },
          },
          required: ["medications", "findings"],
          additionalProperties: false,
        },
      },
    },
    capability: { backend: "local" },
    execute: (args) => assessAdverseReaction(args),
  };
}
