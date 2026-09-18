from database import engine


try:
    connection = engine.connect()
    print("✅ Successfully connected to the CITYFILE SQLite database.")
    connection.close()
except Exception as error:
    print("❌ Database connection failed.")
    print(error)
