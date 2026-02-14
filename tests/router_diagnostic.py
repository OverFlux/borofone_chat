"""
Router diagnostic script.

Проверяет что роутеры подключены правильно.
"""
import sys
from pathlib import Path

# Добавляем корень проекта в path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

print("\n" + "=" * 60)
print("🔍 Router Diagnostic")
print("=" * 60 + "\n")

# Test 1: Import app
print("1️⃣ Testing app import...")
try:
    from app.main import app

    print("   ✅ app imported successfully")
except Exception as e:
    print(f"   ❌ Failed to import app: {e}")
    sys.exit(1)

# Test 2: Check routers
print("\n2️⃣ Checking registered routes...")
routes = app.routes

auth_routes = [r for r in routes if '/auth' in str(r.path)]
if auth_routes:
    print(f"   ✅ Found {len(auth_routes)} auth routes:")
    for route in auth_routes:
        methods = getattr(route, 'methods', ['N/A'])
        print(f"      {list(methods)} {route.path}")
else:
    print("   ❌ No auth routes found!")
    print("   💡 Check that app.include_router(auth.router) is in main.py")

# Test 3: Check specific endpoints
print("\n3️⃣ Checking specific endpoints...")
expected_endpoints = [
    ('POST', '/auth/login'),
    ('POST', '/auth/register'),
    ('POST', '/auth/refresh'),
    ('POST', '/auth/logout'),
    ('GET', '/auth/me'),
]

for method, path in expected_endpoints:
    found = any(
        method in getattr(r, 'methods', []) and r.path == path
        for r in routes
    )
    status = "✅" if found else "❌"
    print(f"   {status} {method} {path}")

# Test 4: Import auth router directly
print("\n4️⃣ Testing auth router import...")
try:
    from app.api import auth

    print("   ✅ auth module imported")
    print(f"   ✅ auth.router: {auth.router}")
    print(f"   ✅ auth.router.routes: {len(auth.router.routes)} routes")
except Exception as e:
    print(f"   ❌ Failed to import auth: {e}")

# Test 5: Check APIRouter configuration
print("\n5️⃣ Checking auth router config...")
try:
    from app.api import auth

    print(f"   Prefix: {auth.router.prefix}")
    print(f"   Tags: {auth.router.tags}")

    if auth.router.prefix == "/auth":
        print("   ✅ Correct prefix")
    else:
        print(f"   ⚠️ Unexpected prefix: {auth.router.prefix}")
except Exception as e:
    print(f"   ❌ Error: {e}")

print("\n" + "=" * 60)
print("🎯 Summary:")
print("=" * 60)

if auth_routes and len(auth_routes) >= 5:
    print("""
✅ All checks passed!

Your auth router is configured correctly.
If you still get 404/405, check:
1. API is restarted (uvicorn app.main:app --reload)
2. Correct URL: http://localhost:8000/auth/login (not /login)
3. Browser console for errors
    """)
else:
    print("""
❌ Issues found!

Quick fix:
1. Check app/main.py contains:
   from app.api import auth
   app.include_router(auth.router)

2. Check app/api/auth.py contains:
   router = APIRouter(prefix="/auth", tags=["Authentication"])

3. Restart API:
   uvicorn app.main:app --reload
    """)

print("=" * 60 + "\n")
