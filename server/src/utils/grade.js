/**
 * Grade auto-calculation utility.
 *
 * Given enrollment_year and enrollment_grade, calculates the current grade
 * based on how many academic years have passed.
 *
 * Academic year boundary: September 1st.
 * Before Sep 1 → still in previous academic year.
 *
 * Grade progression:
 *   小学: 一年级 → 六年级  (6 years)
 *   初中: 初一 → 初三      (3 years)
 *   高中: 高一 → 高三      (3 years)
 *   大学: 大一 → 大四      (4 years)
 *
 * If years exceed the school level's max, returns '已毕业(原X年级)'.
 */

const GRADE_SEQUENCES = {
  // 小学
  '一年级': { seq: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'] },
  '二年级': { seq: ['二年级', '三年级', '四年级', '五年级', '六年级'] },
  '三年级': { seq: ['三年级', '四年级', '五年级', '六年级'] },
  '四年级': { seq: ['四年级', '五年级', '六年级'] },
  '五年级': { seq: ['五年级', '六年级'] },
  '六年级': { seq: ['六年级'] },
  // 初中
  '初一': { seq: ['初一', '初二', '初三'] },
  '初二': { seq: ['初二', '初三'] },
  '初三': { seq: ['初三'] },
  // 高中
  '高一': { seq: ['高一', '高二', '高三'] },
  '高二': { seq: ['高二', '高三'] },
  '高三': { seq: ['高三'] },
  // 大学
  '大一': { seq: ['大一', '大二', '大三', '大四'] },
  '大二': { seq: ['大二', '大三', '大四'] },
  '大三': { seq: ['大三', '大四'] },
  '大四': { seq: ['大四'] },
};

/**
 * Get current academic year.
 * Before Sep 1 → previous year. On/after Sep 1 → current year.
 */
function getCurrentAcademicYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  return month >= 9 ? year : year - 1;
}

/**
 * Calculate current grade from enrollment info.
 * @param {string} enrollmentGrade - Grade at time of enrollment (e.g. '高一')
 * @param {number} enrollmentYear  - Enrollment academic year (e.g. 2024)
 * @returns {string} Current grade or graduation status
 */
function calculateCurrentGrade(enrollmentGrade, enrollmentYear) {
  if (!enrollmentGrade || !enrollmentYear) return enrollmentGrade || '未知';

  const currentAcademicYear = getCurrentAcademicYear();
  const yearsPassed = currentAcademicYear - enrollmentYear;

  if (yearsPassed < 0) return enrollmentGrade; // Future enrollment
  if (yearsPassed === 0) return enrollmentGrade;

  const gradeInfo = GRADE_SEQUENCES[enrollmentGrade];
  if (!gradeInfo) return enrollmentGrade; // Unknown grade format, return as-is

  if (yearsPassed >= gradeInfo.seq.length) {
    return `已毕业(原${enrollmentGrade})`;
  }

  return gradeInfo.seq[yearsPassed];
}

/**
 * Batch update all students' current grade based on enrollment info.
 * Called periodically or on demand.
 */
function refreshAllGrades(db) {
  const students = db.prepare(
    'SELECT id, enrollment_grade, enrollment_year FROM t_student WHERE enrollment_grade IS NOT NULL AND enrollment_year IS NOT NULL AND deleted_at IS NULL'
  ).all();

  const updateStmt = db.prepare(
    "UPDATE t_student SET grade = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
  );

  let updated = 0;
  const updateAll = db.transaction(() => {
    for (const s of students) {
      const newGrade = calculateCurrentGrade(s.enrollment_grade, s.enrollment_year);
      updateStmt.run(newGrade, s.id);
      updated++;
    }
  });
  updateAll();

  return updated;
}

module.exports = { calculateCurrentGrade, getCurrentAcademicYear, refreshAllGrades };
