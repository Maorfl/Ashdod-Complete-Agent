/**
 * DepartmentCus1 — "מחלקה CUS1 · משה רוסו".
 * כרטיסי היבואנים הרלוונטיים למחלקה. בשלב זה כרטיס אחד (יוניליוור).
 * העמוד מתעלם במכוון ממסנן הסוכן הגלובלי — עמוד של מחלקה הוא של אותה מחלקה.
 */
import { Link } from 'react-router-dom';

// רשימה מונעת-נתונים כדי שהוספת יבואן לא תדרוש שינוי מבנה (אין ממשק ניהול בשלב זה)
const CARDS = [
  {
    key: 'unilever',
    name: 'יוניליוור ישראל טיפוח אישי וביתי בע"מ',
    company_id: '510516578',
    to: '/departments/cus1/unilever',
    desc: 'מחולל קובץ ייבוא למסלול (מכון התקנים) מתוך חשבון ספק',
    supplier: 'Unilever Europe BV',
  },
];

export default function DepartmentCus1() {
  return (
    <div>
      <div className="page-head">
        <h1>מחלקה CUS1 · משה רוסו</h1>
        <div className="sub">כלים ייעודיים ליבואני המחלקה</div>
      </div>

      <div className="dept-cards">
        {CARDS.map((c) => (
          <Link key={c.key} to={c.to} className="card dept-card">
            <div className="dept-card-title">{c.name}</div>
            <div className="dept-card-meta mono">ח.פ {c.company_id}</div>
            <div className="dept-card-desc">{c.desc}</div>
            <div className="dept-card-meta">ספק: {c.supplier}</div>
            <div className="dept-card-cta">פתיחת הכלי ←</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
