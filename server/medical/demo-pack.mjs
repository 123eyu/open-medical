import { check } from "../errors.mjs";

// 示例患者包：让新医生不导入任何真实数据就能体验完整工作流
//（诊前速览、检验趋势、随访提醒、今日待办）。示例患者带固定标签，
// 与真实档案永久可区分，一键整包删除；真实数据永不被触碰。
export const DEMO_TAG = "示例患者";
const DAY = 86400000;
const iso = offset => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

const PACK = [
  {
    name: "示例·张沪生", gender: "male", birthYear: 1952, phone: "", tags: [DEMO_TAG], groups: ["示例·高血压"],
    clinicalSummary: { text: "高血压 8 年余，近期血压波动，肾功能稳定。示例数据，可用于体验各页面。", source: "示例数据包" },
    diagnoses: [
      { name: "原发性高血压", code: "I10", date: iso(-2900), status: "confirmed", note: "长期服药，近期波动。", source: "示例数据包" },
      { name: "胆囊切除术后状态", date: iso(-95), status: "confirmed", note: "术后恢复顺利。", source: "示例数据包" },
    ],
    medications: [
      { name: "氨氯地平片", status: "active", dose: "5mg", frequency: "qd", source: "示例数据包" },
      { name: "阿司匹林肠溶片", status: "active", dose: "100mg", frequency: "qd", source: "示例数据包" },
    ],
    allergies: ["青霉素"],
    labs: [
      { item: "血钾", value: 4.1, unit: "mmol/L", date: iso(-10), source: "示例数据包" },
      { item: "血肌酐", value: 96, unit: "μmol/L", date: iso(-10), source: "示例数据包" },
      { item: "血肌酐", value: 92, unit: "μmol/L", date: iso(-100), source: "示例数据包" },
    ],
    visits: [{ date: iso(-10), reason: "门诊复查", note: "血压 148/86，调整用药待观察。", source: "示例数据包" }],
  },
  {
    name: "示例·李婉珍", gender: "female", birthYear: 1966, tags: [DEMO_TAG], groups: ["示例·糖尿病"],
    clinicalSummary: { text: "2 型糖尿病 6 年，HbA1c 波动于 7–8.5%，依从性一般。示例数据。", source: "示例数据包" },
    diagnoses: [{ name: "2型糖尿病", code: "E11.9", date: iso(-2100), status: "confirmed", source: "示例数据包" }],
    medications: [{ name: "二甲双胍", status: "active", dose: "0.5g", frequency: "bid", source: "示例数据包" }],
    labs: [
      { item: "HbA1c", value: 8.4, unit: "%", date: iso(-15), source: "示例数据包" },
      { item: "HbA1c", value: 7.6, unit: "%", date: iso(-105), source: "示例数据包" },
      { item: "HbA1c", value: 7.1, unit: "%", date: iso(-195), source: "示例数据包" },
      { item: "空腹血糖", value: 8.9, unit: "mmol/L", date: iso(-15), source: "示例数据包" },
    ],
    visits: [{ date: iso(-15), reason: "季度复查", note: "控制欠佳，加强饮食运动指导。", source: "示例数据包" }],
  },
  {
    name: "示例·王建国", gender: "male", birthYear: 1978, tags: [DEMO_TAG],
    clinicalSummary: { text: "阑尾切除术后一个月，恢复可，待复查血常规。示例数据。", source: "示例数据包" },
    diagnoses: [{ name: "急性阑尾炎", code: "K35", date: iso(-32), status: "confirmed", source: "示例数据包" }, { name: "腹腔镜阑尾切除术后", date: iso(-30), status: "confirmed", source: "示例数据包" }],
    medications: [],
    labs: [
      { item: "白细胞计数", value: 11.8, unit: "10^9/L", date: iso(-30), source: "示例数据包" },
      { item: "白细胞计数", value: 7.2, unit: "10^9/L", date: iso(-16), source: "示例数据包" },
    ],
    visits: [{ date: iso(-30), reason: "急诊手术", note: "腹腔镜阑尾切除，顺利。", source: "示例数据包" }],
  },
];

export class DemoPack {
  constructor(patients, followups, store) {
    this.patients = patients;
    this.followups = followups;
    this.store = store;
  }
  demoIds() {
    return this.patients.all()
      .filter(p => (p.tags || []).includes(DEMO_TAG) && !p.archived)
      .map(p => p.id);
  }
  status() {
    const ids = this.demoIds();
    return { installed: ids.length > 0, count: ids.length, tag: DEMO_TAG };
  }
  seed() {
    const existing = new Set(this.patients.all().map(p => p.name));
    for (const input of PACK) {
      if (existing.has(input.name)) continue;
      this.patients.create({ ...input, note: "这是示例患者（虚构数据），随时可在首页一键删除，不影响真实档案。" });
    }
    // 到期随访让「今日待办/驾驶舱」立即有内容可体验：随访须约在未来，
    // 创建后把演示 job 的到期时间拨到两天前（仅示例患者，仅此一处）。
    for (const id of this.demoIds()) {
      const patient = this.patients.row(id);
      if ((patient.groups || []).includes("示例·糖尿病") && !this.followups.list(id).length) {
        const job = this.followups.create(id, { name: "血糖控制季度随访", once: false, intervalDays: 90, firstDueAt: new Date(Date.now() + 60000).toISOString(), checklist: ["近期血糖记录", "用药依从性"] });
        const overdue = Date.now() - 2 * DAY;
        this.store.db
          .prepare("UPDATE follow_ups SET next_due=?, data=json_set(data,'$.nextDue',?) WHERE id=?")
          .run(overdue, overdue, job.id);
      }
    }
    return this.status();
  }
  clear() {
    check(this.demoIds().length, "INVALID_INPUT", "没有可删除的示例患者", 404);
    let removed = 0;
    for (const id of this.demoIds()) {
      this.patients.remove(id);
      removed++;
    }
    return { ...this.status(), removed };
  }
}
