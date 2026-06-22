from psycopg_pool import AsyncConnectionPool

pool: AsyncConnectionPool = None


async def get_db():
    async with pool.connection() as conn:
        yield conn
