use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum ApplicationCache {
    Table,
    Id,
    Key,
    ExpiresAt,
    CreatedAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ApplicationCache::Table)
                    .col(
                        ColumnDef::new(ApplicationCache::Id)
                            .uuid()
                            .not_null()
                            .default(PgFunc::gen_random_uuid())
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(ApplicationCache::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(ApplicationCache::Key)
                            .json_binary()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(ApplicationCache::ExpiresAt).timestamp_with_time_zone())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}