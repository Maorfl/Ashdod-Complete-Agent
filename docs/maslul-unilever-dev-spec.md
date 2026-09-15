# מפרט טכני לפיתוח - הפקת קובץ ייבוא למסלול (יוניליוור)

**מסמך זה משלים את `maslul-unilever-spec.md` (הרקע/הדרישות) בפרטים שנדרשים בפועל לפיתוח: חוזה קלט/פלט, אלגוריתם, קריטריוני קבלה, טיפול בשגיאות.**

---

## 0. מה בטוח לבנות עכשיו לעומת מה שעדיין לא סגור

✅ **בטוח לממש כמודול שלם:**
- קריאת PDF של חשבון ספק יוניליוור וחילוץ טבלת השורות (Material, Description, Qty in ZUN, Commodity code).
- כלל הסינון "50ML" (סעיף 2.1).
- מיפוי Commodity code `33072000` ← פרט מכס `3307200000/4` (קבוע, כרגע אין דוגמה נגדית).
- מיפוי כמויות D=E=F מתוך Qty in ZUN.
- תיאור טובין קבוע "מנפיקי אירוסול".
- הפקת קובץ ה-xlsx בשיטת העריכה הכירורגית של ה-XML (סעיף 3), כולל שמירה על שם הקובץ.
- Lookup לפי קוד חומר מתוך טבלת המיפוי הקיימת (כשקוד חומר כבר מאומת).

⚠️ **לא לממש כלוגיקה דטרמיניסטית סגורה - עדיין דורש מעורבות אנושית:**
- גזירת "קוד דגם" (עמודה B) עבור קוד חומר **חדש** שאינו בטבלת המיפוי (סעיף 4.6 במסמך הרקע). אין עדיין כלל מוכח. יש לממש את זה כ**הצעה מנוחשת + דגל אזהרה מפורש למשתמש**, לא כפלט סופי אוטומטי. כל עוד אין 10+ דוגמאות מאומתות שמראות דפוס עקבי - לא לבנות regex/heuristic "סופי" בשביל זה.

---

## 1. חוזה קלט/פלט (I/O Contract) + Fixtures

תיקיית `fixtures/` המצורפת מכילה 3 מקרי בדיקה אמיתיים שאומתו בפועל מול מסלול (או נגזרו מטבלת מיפוי מאומתת):

| # | קלט | קלט 2 | פלט צפוי | הערה |
|---|---|---|---|---|
| 1 | `01_בקשה_ישנה_מאושרת_10118471_תמלול.md` (תמלול טקסט - ה-PDF המקורי לא נשמר בסביבה) | `02_חשבון_ספק_7113487000.pdf` | `03_פלט_צפוי_מ_חשבון_7113487000.xlsx` | **Ground truth מלא** - כל 7 השורות מאומתות ישירות מול בקשה שאושרה בפועל במסלול. זהו מקרה הבסיס (bootstrap) ליוניליוור. |
| 2 | - | `06_חשבון_ספק_7113482802_מקור.pdf` | `04_פלט_מ_חשבון_7113482802.xlsx` | 8 שורות בחשבון → 7 בפלט (שורה אחת הוחרגה, 50ML). מתוכן: 2 שורות מאומתות (קוד חומר חוזר מ-fixture 1), 5 שורות **ניחוש בלבד** - ר' טבלת מיפוי בקובץ הרקע לסטטוס מדויק לכל שורה. **לא לקחת את זה כ-ground truth מלא** - רק החלק המאומת בו. |
| 3 | - | `07_חשבון_ספק_7113482826_מקור.pdf` | `05_פלט_מ_חשבון_7113482826.xlsx` | 3 שורות, ללא החרגות. 1 שורה מאומתת (מ-fixture 1), 2 שורות ניחוש (חוזרות מ-fixture 2, עדיין לא אושרו). |
| - | `00_תבנית_ריקה_מקורית.xlsx` | - | - | התבנית הריקה כפי שהורדה מהמערכת - קלט קבוע לכל הפקה (המקור לעריכה הכירורגית). |

**כללי שימוש ב-fixtures לבדיקות:**
- Fixture 1 הוא היחיד שניתן להריץ עליו בדיקת equality מלאה (כל 6 העמודות הרלוונטיות בכל 7 השורות).
- Fixtures 2-3 משמשים בעיקר לבדיקת **מבנה/פורמט הקובץ** (שהוא נטען תקין, לא שבור), ולבדיקת הלוגיקה המאומתת חלקית (החרגת 50ML, כמויות, פרט מכס) - לא לבדיקת דיוק קוד הדגם המנוחש.

---

## 2. אלגוריתם - שלב עיבוד החשבון (parsing + business rules)

```
INPUT: invoice_pdf (חשבון ספק), mapping_table (קוד חומר → קוד דגם מאומת, ללקוח זה)
OUTPUT: list[TemplateRow], list[Warning]

1. parsed_lines = extract_line_items(invoice_pdf)
   # לכל שורה: material_code, description, qty_in_zun, commodity_code

2. filtered_lines = []
   for line in parsed_lines:
       if "50ML" in line.description.upper() and "150ML" not in line.description.upper():
           log("הוחרג עקב כלל 50ML: " + line.material_code)
           continue
       filtered_lines.append(line)

3. output_rows = []
   warnings = []
   for line in filtered_lines:
       tariff_item = map_commodity_to_tariff(line.commodity_code)
       # כרגע: מיפוי קבוע יחיד. אם מגיע commodity_code לא מוכר → warning + לעצור,
       # לא לנחש פרט מכס.
       if tariff_item is None:
           warnings.append(f"קוד HS לא מוכר: {line.commodity_code} עבור {line.material_code} - נדרש אישור ידני")
           continue

       if line.material_code in mapping_table:
           model_code = mapping_table[line.material_code]
           confirmed = True
       else:
           model_code = guess_model_code(line.description)  # ר' סעיף 0 - לא דטרמיניסטי מלא
           confirmed = False
           warnings.append(f"קוד דגם מנוחש (לא מאומת): {line.material_code} → {model_code}")

       output_rows.append(TemplateRow(
           tariff_item=tariff_item,
           model_code=model_code,
           description="מנפיקי אירוסול",
           qty_customs_book=line.qty_in_zun,
           qty_request=line.qty_in_zun,
           qty_standards_institute=line.qty_in_zun,
           fob_value=None,  # לא חובה אצל יוניליוור
           confirmed=confirmed,
       ))

4. return output_rows, warnings
```

**חובה:** הפלט (`output_rows`) חייב לכלול לכל שורה את הדגל `confirmed` (True/False), ולהציג אותו למשתמש - **אסור** שהאפליקציה תציג פלט "נקי" בלי לסמן מה מנוחש. זו לא רק דרישת UX, זו דרישת בטיחות עסקית (הצהרת יבוא מוטעית = בעיה משפטית/מכסית).

---

## 3. אלגוריתם - שלב הפקת קובץ ה-Excel (חובה!)

**חל איסור מוחלט על `openpyxl.load_workbook().save()` או כל פעולה ששוכתבת את כל ה-package** - ר' הסבר מלא ב-`maslul-project-prompt.md` סעיף "אזהרה טכנית קריטית". להלן האלגוריתם המדויק שאומת בפועל:

```
INPUT: template_path (הנתיב לתבנית הריקה, כפי שהורדה מהמערכת), rows: list[TemplateRow]
OUTPUT: קובץ xlsx תקין, באותו שם קובץ בדיוק כמו template_path

1. extract sheet1_xml_text = read xl/worksheets/sheet1.xml from template_path (כ-zip)

2. for i, row in enumerate(rows):
       row_index = 4 + i   # הנתונים מתחילים בשורה 4
       if row_index > 203:
           raise Error("חריגה ממגבלת 200 שורות מוצר")

       for col, value, is_text in [
           ('A', row.tariff_item, True),
           ('B', row.model_code, True),
           ('C', row.description, True),
           ('D', row.qty_customs_book, False),
           ('E', row.qty_request, False),
           ('F', row.qty_standards_institute, False),
           # G מדולג - לא חובה אצל יוניליוור
       ]:
           cell_ref = f"{col}{row_index}"
           # לאתר את התא הריק הקיים בתבנית: <c r="A4" s="24"/>
           match = find_empty_cell_tag(sheet1_xml_text, cell_ref)
           if not match:
               raise Error(f"תא {cell_ref} לא נמצא בתבנית - מבנה תבנית שונה מהצפוי")
           style_id = match.style_attribute

           if is_text:
               new_tag = f'<c r="{cell_ref}" s="{style_id}" t="inlineStr"><is><t>{xml_escape(value)}</t></is></c>'
           else:
               new_tag = f'<c r="{cell_ref}" s="{style_id}"><v>{value}</v></c>'

           sheet1_xml_text = replace_once(sheet1_xml_text, match.full_tag, new_tag)

3. build output zip:
       open template_path as zin (zip)
       open output at SAME filename as template_path, in a different directory, as zout (zip)
       for each item in zin:
           data = zin.read(item)
           if item.filename == 'xl/worksheets/sheet1.xml':
               data = sheet1_xml_text.encode('utf-8')
           zout.writestr(item, data)   # שאר כל הקבצים ללא שינוי, כולל metadata של ה-ZipInfo

4. return output path
```

### קריטריוני קבלה (Acceptance Criteria) - בדיקה אוטומטית חובה אחרי כל הפקה

לפני שקובץ נחשב "מוכן למסירה", להריץ באופן אוטומטי:

1. **רשימת קבצים בתוך ה-zip זהה למקור** (שמות, לא בהכרח byte-content) - `set(names_in_output) == set(names_in_template)`.
2. **`xl/worksheets/sheet1.xml` מכיל `<legacyDrawing r:id="rId3"/>`** (או מה שהיה במקור) - כלומר הקישור לא נעלם.
3. **כל קובץ אחר מלבד `sheet1.xml` זהה ביט-לביט למקור** (checksum/hash per file).
4. **הקובץ נטען בהצלחה עם openpyxl בקריאה בלבד** (`load_workbook(path)`, ללא save) ומחזיר את הערכים הצפויים בתאים A4:F(3+n).
5. אורך כל ערך טקסט בעמודות A/B/C לא חורג מהמגבלה (12/35/140 תווים בהתאמה) - **quality gate**, לא רק תיעוד.

אם אחד מהתנאים נכשל - **לא למסור את הקובץ למשתמש**, להחזיר שגיאה מפורשת.

---

## 4. טיפול בשגיאות - מקרים שצריך להגדיר במפורש

| מצב | התנהגות נדרשת |
|---|---|
| קוד חומר לא מופיע בטבלת המיפוי | להפיק ניחוש + דגל `confirmed=False` בולט, לא לחסום את כל הקובץ בגללו |
| Commodity code לא מוכר (שונה מ-33072000) | **לעצור את השורה הזו**, להתריע למשתמש, לא לנחש פרט מכס |
| יותר מ-200 שורות מוצר בחשבון (אחרי סינון) | לחסום ולהתריע - לא לחתוך בשקט |
| ערך טקסט חורג ממגבלת האורך (A/B/C) | לחסום את השורה הספציפית ולהתריע - לא לחתוך את הטקסט בשקט (חיתוך שקט עלול ליצור קוד דגם שגוי) |
| תבנית שהועלתה לא תואמת למבנה הצפוי (חסרים תאים, עמודות שונות) | לעצור מיד, לא לנסות "להתאים" |
| PDF של חשבון שלא ניתן לפרסר (סריקה/תמונה באיכות נמוכה) | להתריע שנדרשת בדיקה ידנית, לא להמשיך עם נתונים חלקיים בלי לסמן זאת |

---

## 5. המלצת סביבת/טכנולוגיית פיתוח

- **שפה:** Python (יש כבר קוד ייחוס עובד מהשיחה - regex + zipfile על ה-XML, בלי openpyxl לשלב הכתיבה. openpyxl כן בסדר **לקריאה בלבד** לבדיקת התוצאה).
- **ספריית PDF:** כל ספריית extraction טקסט/טבלאות סטנדרטית (למשל pdfplumber) - החשבונות הם PDF עם טקסט אמיתי (לא סריקה), כך שאין צורך ב-OCR במקרה הנוכחי.
- **מבנה קוד מוצע:**
  - `invoice_parser.py` - חילוץ שורות מהחשבון (Material, Description, Qty in ZUN, Commodity code)
  - `business_rules_unilever.py` - כללי הסינון/מיפוי הספציפיים ליוניליוור (מיישם ממשק גנרי כדי שילקוחות אחרים יהיה קל להוסיף מודול מקביל)
  - `mapping_store.py` - קריאה/כתיבה של טבלת קוד חומר←קוד דגם (כרגע MD, אפשר גם JSON/CSV מקביל לנוחות תכנותית)
  - `template_writer.py` - מימוש האלגוריתם בסעיף 3 בלבד (העריכה הכירורגית) + קריטריוני הקבלה בסעיף 3
  - `main.py` - חיבור השרשרת + הפקת דו"ח סיכום (אילו שורות הוחרגו/אושרו/נוחשו)

---

## 6. מה עדיין דורש אותך (לא ניתן לאוטומציה מלאה כרגע)

1. אישור/תיקון קודי דגם מנוחשים (סעיף 0) - כל עוד אין 10+ נקודות דאטה מאומתות לכל דפוס.
2. אישור מפורש כאשר מופיע קוד HS/Commodity code חדש שלא נראה עדיין.
3. בדיקת קובץ הפלט בפועל מול מסלול לפני כל שינוי משמעותי בקוד (regression testing ידני, לפחות עד שיש מספיק fixtures מאומתים).
