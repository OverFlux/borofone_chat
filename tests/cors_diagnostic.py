"""
CORS Diagnostic Tool

Запусти этот скрипт чтобы проверить CORS настройки:
python cors_diagnostic.py
"""
import asyncio
import httpx


async def test_cors():
    """Тест CORS с cookies."""

    print("\n" + "=" * 60)
    print("🔍 CORS Diagnostic Tool")
    print("=" * 60 + "\n")

    base_url = "http://localhost:8000"

    # Test 1: OPTIONS request (preflight)
    print("1️⃣ Testing OPTIONS (preflight) request...")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.options(
                f"{base_url}/auth/login",
                headers={
                    "Origin": "http://localhost:8000",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type",
                }
            )

            print(f"   Status: {response.status_code}")
            print(f"   Headers:")

            cors_headers = {
                k: v for k, v in response.headers.items()
                if k.lower().startswith('access-control')
            }

            for key, value in cors_headers.items():
                print(f"      {key}: {value}")

            # Проверки
            if response.status_code == 200:
                print("   ✅ OPTIONS request successful")
            else:
                print(f"   ❌ OPTIONS request failed: {response.status_code}")

            if 'access-control-allow-credentials' in response.headers:
                if response.headers['access-control-allow-credentials'] == 'true':
                    print("   ✅ allow-credentials: true")
                else:
                    print("   ❌ allow-credentials is not 'true'")
            else:
                print("   ❌ Missing access-control-allow-credentials header")

            if 'access-control-allow-origin' in response.headers:
                origin = response.headers['access-control-allow-origin']
                if origin != '*':
                    print(f"   ✅ allow-origin: {origin}")
                else:
                    print("   ❌ allow-origin is '*' (должен быть конкретный origin)")
            else:
                print("   ❌ Missing access-control-allow-origin header")

    except Exception as e:
        print(f"   ❌ Error: {e}")

    print()

    # Test 2: POST login request
    print("2️⃣ Testing POST /auth/login...")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/auth/login",
                json={"email": "test@test.com", "password": "password"},
                headers={"Origin": "http://localhost:8000"}
            )

            print(f"   Status: {response.status_code}")

            if 'set-cookie' in response.headers:
                print("   ✅ Set-Cookie header present")
                cookies = response.headers.get_list('set-cookie')
                for cookie in cookies:
                    print(f"      {cookie[:50]}...")
            else:
                print("   ❌ No Set-Cookie header")

    except Exception as e:
        print(f"   ❌ Error: {e}")

    print()

    # Test 3: GET /auth/me with cookies
    print("3️⃣ Testing GET /auth/me (should fail without cookies)...")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{base_url}/auth/me",
                headers={"Origin": "http://localhost:8000"}
            )

            print(f"   Status: {response.status_code}")

            if response.status_code == 401:
                print("   ✅ Returns 401 without cookies (expected)")
            else:
                print(f"   ⚠️ Unexpected status: {response.status_code}")

    except Exception as e:
        print(f"   ❌ Error: {e}")

    print("\n" + "=" * 60)
    print("🎯 Recommendations:")
    print("=" * 60)
    print("""
1. Check app/main.py:
   - allow_credentials=True
   - allow_origins=[specific origins, not "*"]
   - expose_headers=["Set-Cookie"]

2. Check frontend:
   - credentials: 'include' in all fetch()
   - Same origin as backend (or in CORS list)

3. Check browser console:
   - DevTools → Console → любые CORS ошибки?
   - DevTools → Network → login request → Response Headers

4. Common issues:
   - allow_origins=["*"] with credentials → NOT ALLOWED
   - Missing credentials: 'include' in fetch
   - Different ports not in CORS list
    """)
    print("=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(test_cors())

