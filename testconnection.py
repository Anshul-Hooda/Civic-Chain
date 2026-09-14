from database import engine

try:
    connection = engine.connect()
    print("✅ Successfully connected to MySQL!")
    connection.close()

except Exception as e:
    print("❌ Connection failed!")
    print(e)