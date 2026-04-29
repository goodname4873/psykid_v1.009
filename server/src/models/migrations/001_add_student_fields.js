/**
 * Migration 001: Add student management fields
 *
 * - enrollment_grade: 入学时年级（快照，不变）
 * - enrollment_year:  入学学年（用于自动推算当前年级）
 * - added_by:         添加人 teacher_id
 * - notes:            备注
 */
module.exports = {
  name: 'add_student_management_fields',
  up(db) {
    // SQLite ALTER TABLE only supports ADD COLUMN one at a time
    db.exec(`ALTER TABLE t_student ADD COLUMN enrollment_grade TEXT`);
    db.exec(`ALTER TABLE t_student ADD COLUMN enrollment_year INTEGER`);
    db.exec(`ALTER TABLE t_student ADD COLUMN added_by INTEGER`);
    db.exec(`ALTER TABLE t_student ADD COLUMN notes TEXT`);

    // Backfill existing students: copy current grade as enrollment_grade
    db.exec(`
      UPDATE t_student
      SET enrollment_grade = grade,
          enrollment_year = CAST(strftime('%Y', created_at) AS INTEGER)
      WHERE enrollment_grade IS NULL
    `);
  }
};
