-- CreateIndex
-- GET /api/auth/users filters WHERE schoolId AND role IN (...), with no
-- supporting index this was a sequential scan on the users table.
CREATE INDEX "users_school_id_role_idx" ON "auth_db"."users"("school_id", "role");
