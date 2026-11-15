from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import hmac
import os
import re
import secrets
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

from cryptography.fernet import Fernet
import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError, PyMongoError


ROOT = Path(__file__).resolve().parent
MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017")
MONGO_DB = os.getenv("MONGO_DB", "convoy")
ADMIN_PHONE = os.getenv("CONVOY_ADMIN_PHONE", "")
ACCESS_USERNAME = os.getenv("CONVOY_ACCESS_USERNAME", "preview")
ACCESS_PASSWORD = os.getenv("CONVOY_ACCESS_PASSWORD", "")
ACCESS_PASSWORD_REQUIRED = os.getenv("CONVOY_REQUIRE_ACCESS_PASSWORD", "").lower() == "true"
ENTRY_FEE = 500
SUCCESS_FEE = 2000
DEMO_OTP = os.getenv("CONVOY_DEMO_OTP", "")
SESSION_COOKIE = "convoy_session"
SESSION_DURATION = timedelta(hours=12)
CITIES = {"Gurgaon", "Noida"}
PURCHASE_WINDOWS = {"WITHIN_30_DAYS", "ONE_TO_THREE_MONTHS", "THREE_TO_SIX_MONTHS"}
STOCK_STATUSES = {"CONFIRMED", "EXPECTED", "UNCONFIRMED"}
DEALER_PERMISSION_KEYS = ("sell", "payments", "ratings", "issues", "inventory")
DEFAULT_DEALER_PERMISSIONS = {
    "sell": False,
    "payments": False,
    "ratings": False,
    "issues": False,
    "inventory": False,
}
CATALOG = {
    "Maruti Suzuki": ["Alto K10", "S-Presso", "Celerio", "Wagon R", "Swift", "Baleno", "Dzire", "Brezza", "Fronx", "Grand Vitara", "Jimny", "Ertiga", "XL6", "Invicto", "Eeco", "e Vitara"],
    "Hyundai": ["Grand i10 Nios", "i20", "Aura", "Verna", "Exter", "Venue", "Venue N Line", "Creta", "Creta N Line", "Alcazar", "Tucson", "Ioniq 5"],
    "Tata Motors": ["Tiago", "Tigor", "Altroz", "Punch", "Nexon", "Curvv", "Harrier", "Safari", "Sierra", "Tiago EV", "Punch EV", "Nexon EV", "Curvv EV", "Harrier EV"],
    "Mahindra": ["Bolero", "Bolero Neo", "Thar", "Thar ROXX", "Scorpio Classic", "Scorpio-N", "XUV 3XO", "XUV 700", "BE 6", "XEV 9e", "XUV 400"],
    "Kia": ["Sonet", "Seltos", "Carens", "Carens Clavis", "Carnival", "EV6", "EV9", "Syros"],
    "Toyota": ["Glanza", "Taisor", "Rumion", "Urban Cruiser Hyryder", "Innova Crysta", "Innova Hycross", "Fortuner", "Legender", "Hilux", "Camry", "Vellfire", "Land Cruiser 300"],
    "Honda": ["Amaze", "City", "Elevate"],
    "MG (JSW MG Motor)": ["Comet EV", "Windsor EV", "ZS EV", "Astor", "Hector", "Hector Plus", "Gloster", "Cyberster", "M9"],
    "Skoda": ["Kylaq", "Slavia", "Kushaq", "Kodiaq", "Octavia RS"],
    "Volkswagen": ["Taigun", "Virtus", "Tiguan R-Line", "Golf GTI"],
    "Renault": ["Kwid", "Triber", "Kiger"],
    "Nissan": ["Magnite", "X-Trail"],
    "Citroën": ["C3", "Aircross", "Basalt", "eC3", "C5 Aircross"],
    "Jeep": ["Compass", "Meridian", "Wrangler", "Grand Cherokee"],
    "BYD": ["Atto 3", "Seal", "eMax 7", "Sealion 7"],
    "VinFast": ["VF 6", "VF 7"],
    "Isuzu": ["D-Max V-Cross", "Hi-Lander", "MU-X"],
    "Force Motors": ["Gurkha", "Urbania"],
    "BMW": ["2 Series Gran Coupe", "3 Series LWB", "5 Series LWB", "7 Series", "i4", "i5", "i7", "iX1", "iX", "X1", "X3", "X5", "X7", "Z4", "M models"],
    "Mercedes-Benz": ["A-Class Limousine", "C-Class", "E-Class LWB", "S-Class", "CLA", "GLA", "GLC", "GLE", "GLS", "EQA", "EQB", "EQE SUV", "EQS", "AMG models"],
    "Audi": ["A4", "A6", "A8 L", "Q3", "Q5", "Q7", "Q8", "Q8 e-tron", "e-tron GT", "S/RS models"],
    "Volvo": ["EX30", "EX40", "EC40", "XC60", "XC90"],
    "Lexus": ["ES", "NX", "RX", "LX", "LM"],
    "Land Rover": ["Defender", "Discovery Sport", "Discovery", "Range Rover Evoque", "Range Rover Velar", "Range Rover Sport", "Range Rover"],
    "Porsche": ["Macan", "Macan Electric", "Cayenne", "Panamera", "Taycan", "911", "718"],
    "Mini": ["Cooper S", "Countryman", "Convertible"],
    "Jaguar": ["F-Pace"],
    "Lamborghini": ["Urus SE", "Revuelto", "Temerario"],
    "Ferrari": ["296 GTB/GTS", "Roma Spider", "Purosangue", "12Cilindri", "SF90"],
    "Rolls-Royce": ["Ghost", "Cullinan", "Spectre", "Phantom"],
    "Bentley": ["Bentayga", "Continental GT", "Flying Spur"],
    "Aston Martin": ["Vantage", "DB12", "DBX707", "Vanquish"],
    "Maserati": ["Grecale", "GranTurismo", "MC20"],
    "Tesla": ["Model Y"],
}
VEHICLES = {model: make for make, models in CATALOG.items() for model in models}
client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=1500, tz_aware=True)
_indexes_ready = False

app = FastAPI(title="Convoy group-buying demo", docs_url=None, redoc_url=None, openapi_url=None)


class OtpRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=10)
    role: str


class OtpVerification(BaseModel):
    phone: str = Field(min_length=10, max_length=10)
    role: str
    otp: str = Field(min_length=6, max_length=6)
    name: str = Field(default="", max_length=40)
    dealer_name: str = Field(default="", max_length=60)
    city: str = Field(default="", max_length=30)
    make: str = Field(default="", max_length=40)


class CustomerProfileUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    aadhaar: str = Field(default="", max_length=12)
    pan: str = Field(default="", max_length=10)


class GroupCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=40)
    make: str
    model: str
    model_year: int = Field(ge=2020, le=2030)
    variant: str
    fuel_type: str
    transmission: str
    city: str
    target_member_count: int = Field(default=5, ge=3, le=20)
    minimum_member_count: int = Field(default=3, ge=3, le=20)
    purchase_window: str
    purchase_end_date: date | None = None
    visibility: Literal["PUBLIC"] = "PUBLIC"


class QuoteCreate(BaseModel):
    vehicle_colour: str = Field(min_length=1, max_length=50)
    dealer_location: str = Field(min_length=5, max_length=200)
    salesperson_name: str = Field(min_length=2, max_length=60)
    manager_name: str = Field(min_length=2, max_length=60)
    authorization_reference: str = Field(min_length=1, max_length=100)
    ex_showroom: int = Field(ge=1000, le=100_000_000)
    dealer_discount: int = Field(ge=0, le=10_000_000)
    manufacturer_benefit: int = Field(default=0, ge=0, le=10_000_000)
    exchange_bonus: int = Field(default=0, ge=0, le=10_000_000)
    exchange_condition: str = Field(default="", max_length=500)
    corporate_benefit: int = Field(default=0, ge=0, le=10_000_000)
    corporate_condition: str = Field(default="", max_length=500)
    insurance_amount: int = Field(ge=0, le=10_000_000)
    insurance_type: Literal["DEALER", "BUYER_ARRANGED"]
    insurance_provider: str = Field(default="", max_length=100)
    registration_amount: int = Field(ge=0, le=10_000_000)
    road_tax_amount: int = Field(default=0, ge=0, le=10_000_000)
    other_taxes_amount: int = Field(default=0, ge=0, le=10_000_000)
    other_taxes_explanation: str = Field(default="", max_length=500)
    tcs_amount: int = Field(default=0, ge=0, le=10_000_000)
    fastag_amount: int = Field(default=0, ge=0, le=10_000_000)
    hypothecation_amount: int = Field(default=0, ge=0, le=10_000_000)
    gst_included_amount: int = Field(default=0, ge=0, le=10_000_000)
    accessories_amount: int = Field(default=0, ge=0, le=10_000_000)
    handling_amount: int = Field(default=0, ge=0, le=10_000_000)
    logistics_amount: int = Field(default=0, ge=0, le=10_000_000)
    other_charges: int = Field(default=0, ge=0, le=10_000_000)
    other_charges_explanation: str = Field(default="", max_length=500)
    group_benefit_total: int = Field(default=0, ge=0, le=100_000_000)
    group_benefit_description: str = Field(default="", max_length=200)
    delivery_estimate: str = Field(min_length=1, max_length=120)
    stock_status: str
    quote_valid_until: date
    terms: str = Field(default="", max_length=2000)


class QuoteSelection(BaseModel):
    quote_id: str = Field(min_length=1, max_length=80)


class DealerPermissionUpdate(BaseModel):
    sell: bool = False
    payments: bool = False
    ratings: bool = False
    issues: bool = False
    inventory: bool = False


class InventoryCreate(BaseModel):
    model: str
    model_year: int = Field(ge=2020, le=2030)
    variant: str = Field(min_length=1, max_length=80)
    fuel_type: str
    transmission: str
    colour: str = Field(min_length=1, max_length=50)
    city: str
    quantity: int = Field(ge=0, le=500)
    stock_status: Literal["IN_STOCK", "EXPECTED", "OUT_OF_STOCK"]
    expected_delivery: str = Field(default="", max_length=120)


class RatingCreate(BaseModel):
    quote_id: str = Field(min_length=1, max_length=80)
    rating: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=800)


class IssueCreate(BaseModel):
    category: Literal["QUOTE", "PAYMENT", "VEHICLE", "DEALER", "ACCOUNT", "OTHER"]
    group_id: str = Field(default="", max_length=80)
    description: str = Field(min_length=10, max_length=1000)


class IssueUpdate(BaseModel):
    status: Literal["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"]
    admin_note: str = Field(default="", max_length=1000)


class DealerVerification(BaseModel):
    status: Literal["VERIFIED", "REJECTED"]
    reason: str = Field(default="", max_length=500)


class AdminDealerCreate(BaseModel):
    phone: str = Field(min_length=10, max_length=10)
    dealer_name: str = Field(min_length=2, max_length=60)
    city: str = Field(min_length=1, max_length=30)
    make: str = Field(min_length=1, max_length=40)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def as_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def get_database():
    global _indexes_ready
    try:
        client.admin.command("ping")
        database = client[MONGO_DB]
        if not _indexes_ready:
            database["otp_challenges"].create_index("expiresAt", expireAfterSeconds=0)
            database["sessions"].create_index("expiresAt", expireAfterSeconds=0)
            database["groups"].create_index([("city", 1), ("model", 1), ("status", 1)])
            database["quotes"].create_index([("groupId", 1), ("dealerId", 1), ("revision", 1)], unique=True)
            database["quotes"].create_index([("groupId", 1), ("status", 1)])
            database["inventory"].create_index([("dealerId", 1), ("city", 1), ("model", 1)])
            database["ratings"].create_index([("groupId", 1), ("userId", 1)], unique=True)
            database["ratings"].create_index([("dealerId", 1), ("createdAt", -1)])
            database["issues"].create_index([("reporterId", 1), ("createdAt", -1)])
            database["issues"].create_index([("status", 1), ("createdAt", -1)])
            database["audit_logs"].create_index([("createdAt", -1)])
            database["audit_logs"].create_index([("entityId", 1), ("createdAt", -1)])
            _indexes_ready = True
        return database
    except PyMongoError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "MongoDB is unavailable. Start the local MongoDB service and "
                "check MONGO_URI before signing in."
            ),
        ) from exc


def clean_phone(phone: str) -> str:
    normalized = phone.strip()
    if not re.fullmatch(r"[6-9]\d{9}", normalized):
        raise HTTPException(status_code=422, detail="Enter a valid 10-digit Indian mobile number.")
    return normalized


def clean_role(role: str) -> str:
    normalized = role.strip().upper()
    if normalized not in {"CUSTOMER", "DEALER", "ADMIN"}:
        raise HTTPException(status_code=422, detail="Choose Customer, Dealer, or Admin.")
    return normalized


def require_demo_auth_configuration(role: str):
    if len(DEMO_OTP) != 6 or not DEMO_OTP.isdigit():
        raise HTTPException(
            status_code=503,
            detail="Demo sign-in is not configured. Set CONVOY_DEMO_OTP to a six-digit value in the server environment.",
        )
    if role == "ADMIN" and not re.fullmatch(r"[6-9]\d{9}", ADMIN_PHONE):
        raise HTTPException(
            status_code=503,
            detail="Admin sign-in is not configured. Set CONVOY_ADMIN_PHONE to a valid 10-digit Indian mobile number in the server environment.",
        )


def session_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_view(user: dict) -> dict:
    return {
        "id": user["_id"],
        "phone": user["phone"],
        "role": user["role"],
        "name": user.get("name", ""),
        "dealerName": user.get("dealerName", ""),
        "city": user.get("city", ""),
        "make": user.get("make", ""),
        "verificationStatus": user.get("verificationStatus", ""),
        "permissions": {
            key: bool(user.get("permissions", {}).get(key, False))
            for key in DEALER_PERMISSION_KEYS
        } if user["role"] == "DEALER" else {},
    }


def customer_profile_view(user: dict) -> dict:
    has_aadhaar = bool(user.get("aadhaarCiphertext"))
    has_pan = bool(user.get("panCiphertext"))
    name = user.get("name", "")
    completed = sum((bool(name), has_aadhaar, has_pan))
    return {
        "name": name,
        "aadhaarAdded": has_aadhaar,
        "aadhaarMasked": f"XXXX-XXXX-{user.get('aadhaarLast4', '')}" if has_aadhaar else "",
        "panAdded": has_pan,
        "panMasked": f"XXXXXX{user.get('panLast4', '')}" if has_pan else "",
        "completionPercent": round(completed / 3 * 100),
        "complete": completed == 3,
    }


def pii_fernet() -> Fernet:
    key = os.getenv("CONVOY_PII_ENCRYPTION_KEY", "")
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Sensitive profile storage is not configured. Set CONVOY_PII_ENCRYPTION_KEY before saving Aadhaar or PAN.",
        )
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, binascii.Error, UnicodeEncodeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="CONVOY_PII_ENCRYPTION_KEY is invalid. Generate a Fernet key and keep it stable in the server environment.",
        ) from exc


def require_user(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    database = get_database()
    session = database["sessions"].find_one({
        "_id": session_hash(token),
        "expiresAt": {"$gt": utc_now()},
    })
    if not session:
        raise HTTPException(status_code=401, detail="Your session expired. Sign in again.")
    user = database["users"].find_one({"_id": session["userId"]})
    if not user:
        raise HTTPException(status_code=401, detail="Your account was not found. Sign in again.")
    return user


def require_role(role: str):
    def role_dependency(user: dict = Depends(require_user)) -> dict:
        if user["role"] != role:
            raise HTTPException(status_code=403, detail=f"This action is for {role.lower()} accounts.")
        return user

    return role_dependency


def require_dealer_permission(permission: str):
    def permission_dependency(user: dict = Depends(require_role("DEALER"))) -> dict:
        if user.get("verificationStatus") != "VERIFIED":
            raise HTTPException(status_code=403, detail="An admin must review this demo dealer before granting feature access.")
        if not user.get("permissions", {}).get(permission, False):
            raise HTTPException(status_code=403, detail=f"An admin has not granted dealer access to {permission}.")
        return user

    return permission_dependency


def audit(database, actor: dict, entity_type: str, entity_id: str, action: str, details: dict | None = None):
    database["audit_logs"].insert_one({
        "actorHash": hashlib.sha256(actor["_id"].encode("utf-8")).hexdigest(),
        "entityType": entity_type,
        "entityId": entity_id,
        "action": action,
        "details": details or {},
        "createdAt": utc_now(),
    })


def validate_vehicle(make: str, model: str, variant: str, fuel: str, transmission: str):
    if model not in CATALOG.get(make, []):
        raise HTTPException(status_code=422, detail="Choose a model from the supported vehicle catalogue.")
    if fuel not in {"Petrol", "Diesel", "EV", "CNG"}:
        raise HTTPException(status_code=422, detail="Choose Petrol, Diesel, EV, or CNG.")
    if transmission not in {"Manual", "Automatic"}:
        raise HTTPException(status_code=422, detail="Choose Manual or Automatic transmission.")
    if not variant.strip():
        raise HTTPException(status_code=422, detail="Enter the preferred vehicle variant or trim.")


def active_quotes(database, group_id: str) -> list[dict]:
    now = utc_now()
    latest_by_dealer = {}
    quotes = database["quotes"].find({"groupId": group_id, "status": "SUBMITTED"})
    for quote in quotes:
        if quote["validUntil"] <= now:
            continue
        current = latest_by_dealer.get(quote["dealerId"])
        if current is None or quote["revision"] > current["revision"]:
            latest_by_dealer[quote["dealerId"]] = quote
    result = []
    for quote in latest_by_dealer.values():
        summary = next(database["ratings"].aggregate([
            {"$match": {"dealerId": quote["dealerId"]}},
            {"$group": {"_id": None, "count": {"$sum": 1}, "average": {"$avg": "$rating"}}},
        ]), None)
        result.append(public_quote(quote) | {
            "ratingSummary": {
                "count": summary["count"],
                "average": round(summary["average"], 1),
            } if summary else {"count": 0, "average": None},
        })
    return sorted(result, key=lambda quote: (quote["onRoadTotal"], quote["submittedAt"] or ""))


def public_quote(quote: dict) -> dict:
    return {
        "id": quote["_id"],
        "quoteReference": quote["quoteReference"],
        "revision": quote["revision"],
        "dealerName": quote["dealerName"],
        "dealerDemoApprovalStatus": quote.get("dealerDemoApprovalStatus", "UNKNOWN"),
        "dealerLocation": quote.get("dealerLocation", ""),
        "salespersonName": quote.get("salespersonName", ""),
        "managerName": quote.get("managerName", ""),
        "authorizationReference": quote.get("authorizationReference", ""),
        "vehicleVariant": quote.get("vehicleVariant", ""),
        "vehicleColour": quote.get("vehicleColour", ""),
        "quantity": quote["quantity"],
        "exShowroom": quote["exShowroom"],
        "gstIncludedAmount": quote.get("gstIncludedAmount", 0),
        "dealerDiscount": quote["dealerDiscount"],
        "manufacturerBenefit": quote["manufacturerBenefit"],
        "exchangeBonus": quote["exchangeBonus"],
        "exchangeCondition": quote["exchangeCondition"],
        "corporateBenefit": quote["corporateBenefit"],
        "corporateCondition": quote["corporateCondition"],
        "insuranceAmount": quote["insuranceAmount"],
        "insuranceType": quote["insuranceType"],
        "insuranceProvider": quote["insuranceProvider"],
        "registrationAmount": quote["registrationAmount"],
        "roadTaxAmount": quote.get("roadTaxAmount", 0),
        "otherTaxesAmount": quote.get("otherTaxesAmount", 0),
        "otherTaxesExplanation": quote.get("otherTaxesExplanation", ""),
        "tcsAmount": quote["tcsAmount"],
        "fastagAmount": quote.get("fastagAmount", 0),
        "hypothecationAmount": quote.get("hypothecationAmount", 0),
        "accessoriesAmount": quote["accessoriesAmount"],
        "handlingAmount": quote["handlingAmount"],
        "logisticsAmount": quote["logisticsAmount"],
        "otherCharges": quote["otherCharges"],
        "otherChargesExplanation": quote["otherChargesExplanation"],
        "groupBenefitTotal": quote["groupBenefitTotal"],
        "groupBenefitPerVehicle": quote["groupBenefitPerVehicle"],
        "groupBenefitDescription": quote["groupBenefitDescription"],
        "onRoadTotal": quote["onRoadTotal"],
        "groupOnRoadTotal": quote["groupOnRoadTotal"],
        "deliveryEstimate": quote["deliveryEstimate"],
        "stockStatus": quote["stockStatus"],
        "validUntil": as_iso(quote["validUntil"]),
        "terms": quote["terms"],
        "submittedAt": as_iso(quote["submittedAt"]),
        "conditionalBenefits": [
            {"name": "Exchange bonus", "amount": quote["exchangeBonus"], "condition": quote["exchangeCondition"]},
            {"name": "Corporate benefit", "amount": quote["corporateBenefit"], "condition": quote["corporateCondition"]},
        ],
    }


def own_membership(group: dict, user_id: str) -> dict | None:
    matches = [
        member for member in group.get("members", [])
        if member.get("userId") == user_id
    ]
    return matches[-1] if matches else None


def expire_group_if_due(database, group: dict) -> dict:
    if (
        group["status"] in {"OPEN", "TARGET_REACHED", "QUOTING"}
        and group["purchaseEndDate"] <= utc_now().date().isoformat()
    ):
        now = utc_now()
        result = database["groups"].update_one(
            {"_id": group["_id"], "status": group["status"]},
            {"$set": {"status": "EXPIRED", "updatedAt": now},
             "$push": {"events": {"type": "GROUP_EXPIRED", "createdAt": now}}},
        )
        if result.modified_count:
            database["quotes"].update_many(
                {"groupId": group["_id"], "status": "SUBMITTED"},
                {"$set": {"status": "EXPIRED", "invalidatedAt": now}},
            )
            group = database["groups"].find_one({"_id": group["_id"]})
    return group


def public_group(database, group: dict, user_id: str) -> dict:
    membership = own_membership(group, user_id)
    selected_quote = database["quotes"].find_one({"_id": membership.get("selectedQuoteId")}) if (
        membership and membership.get("selectedQuoteId")
    ) else None
    waitlisted = any(
        entry.get("userId") == user_id for entry in group.get("waitlist", [])
    )
    return {
        "id": group["_id"],
        "make": group["make"],
        "model": group["model"],
        "modelYear": group["modelYear"],
        "variant": group["variant"],
        "fuelType": group["fuelType"],
        "transmission": group["transmission"],
        "city": group["city"],
        "targetMemberCount": group["targetMemberCount"],
        "minimumMemberCount": group["minimumMemberCount"],
        "memberCount": group["memberCount"],
        "purchaseWindow": group["purchaseWindow"],
        "purchaseEndDate": group["purchaseEndDate"],
        "visibility": group["visibility"],
        "status": group["status"],
        "createdAt": as_iso(group["createdAt"]),
        "activity": [
            {
                "type": event.get("type", "GROUP_UPDATED"),
                "createdAt": as_iso(event.get("createdAt")),
            }
            for event in group.get("events", [])[-12:]
        ] if membership else [],
        "myMembership": {
            "status": membership["status"],
            "purchaseStatus": membership.get("purchaseStatus", "NOT_SELECTED"),
            "entryPayment": membership.get("entryPayment"),
            "successPayment": membership.get("successPayment"),
            "selectedQuoteId": membership.get("selectedQuoteId"),
            "selectedQuote": public_quote(selected_quote) if selected_quote else None,
            "rating": membership.get("rating"),
        } if membership else ({"status": "WAITLISTED"} if waitlisted else None),
        "quotes": active_quotes(database, group["_id"]),
    }


@app.middleware("http")
async def security_headers(request: Request, call_next):
    if ACCESS_PASSWORD_REQUIRED and (not ACCESS_USERNAME or not ACCESS_PASSWORD):
        return JSONResponse(
            status_code=503,
            content={"detail": "Protected demo access is not configured. Set CONVOY_ACCESS_USERNAME and CONVOY_ACCESS_PASSWORD in the host's environment."},
        )
    if ACCESS_PASSWORD_REQUIRED and request.url.path != "/api/health":
        authorization = request.headers.get("authorization", "")
        authenticated = False
        scheme, separator, encoded = authorization.partition(" ")
        if separator and scheme.lower() == "basic":
            try:
                decoded = base64.b64decode(encoded, validate=True).decode("utf-8")
                username, delimiter, password = decoded.partition(":")
                authenticated = (
                    bool(delimiter)
                    and hmac.compare_digest(username.encode("utf-8"), ACCESS_USERNAME.encode("utf-8"))
                    and hmac.compare_digest(password.encode("utf-8"), ACCESS_PASSWORD.encode("utf-8"))
                )
            except (binascii.Error, UnicodeDecodeError, ValueError):
                authenticated = False
        if not authenticated:
            return Response(
                content="Private Convoy demo. Sign in with the preview access credentials.",
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="Convoy private demo", charset="UTF-8"'},
                media_type="text/plain",
            )
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; base-uri 'none'; "
        "form-action 'self'; frame-ancestors 'none'"
    )
    return response


@app.get("/api/health")
def health():
    database = get_database()
    return {
        "status": "ok",
        "database": "MongoDB",
        "databaseName": database.name,
        "otpMode": "demo",
        "paymentMode": "demo",
    }


@app.get("/api/catalog")
def catalog():
    return [
        {"make": make, "models": models}
        for make, models in CATALOG.items()
    ]


@app.post("/api/auth/request-otp")
def request_otp(payload: OtpRequest):
    phone = clean_phone(payload.phone)
    role = clean_role(payload.role)
    require_demo_auth_configuration(role)
    if role == "ADMIN" and phone != ADMIN_PHONE:
        raise HTTPException(status_code=403, detail="This number is not configured for the local admin demo.")
    database = get_database()
    now = utc_now()
    challenge_id = f"{role}:{phone}"
    database["otp_challenges"].replace_one(
        {"_id": challenge_id},
        {"_id": challenge_id, "phone": phone, "role": role, "otp": DEMO_OTP,
         "createdAt": now, "expiresAt": now + timedelta(minutes=5)},
        upsert=True,
    )
    return {"message": "Demo OTP created. No SMS was sent.", "demoOtp": DEMO_OTP,
            "expiresInSeconds": 300, "demoOnly": True}


@app.post("/api/auth/verify-otp")
def verify_otp(payload: OtpVerification, response: Response):
    phone = clean_phone(payload.phone)
    role = clean_role(payload.role)
    require_demo_auth_configuration(role)
    if role == "ADMIN" and phone != ADMIN_PHONE:
        raise HTTPException(status_code=403, detail="This number is not configured for the local admin demo.")
    if role == "DEALER" and (not payload.dealer_name.strip() or payload.city.strip() not in CITIES):
        raise HTTPException(status_code=422, detail="Enter your dealership name and choose Gurgaon or Noida.")
    if role == "DEALER" and payload.make.strip() not in set(VEHICLES.values()):
        raise HTTPException(status_code=422, detail="Choose a supported dealership make.")

    database = get_database()
    challenge_id = f"{role}:{phone}"
    challenge = database["otp_challenges"].find_one({
        "_id": challenge_id,
        "otp": payload.otp,
        "expiresAt": {"$gt": utc_now()},
    })
    if not challenge:
        raise HTTPException(status_code=401, detail="Invalid or expired demo OTP.")

    user_id = f"{role}:{phone}"
    profile = {"_id": user_id, "phone": phone, "role": role, "updatedAt": utc_now()}
    if role == "CUSTOMER" and payload.name.strip():
        profile["name"] = payload.name.strip()
    if role == "DEALER":
        existing = database["users"].find_one({"_id": user_id})
        profile.update({
            "dealerName": payload.dealer_name.strip(),
            "city": payload.city.strip(),
            "make": payload.make.strip(),
            "verificationStatus": (existing or {}).get("verificationStatus", "PENDING"),
        })
    database["users"].update_one({"_id": user_id}, {"$set": profile}, upsert=True)
    database["otp_challenges"].delete_one({"_id": challenge_id})

    token = secrets.token_urlsafe(32)
    database["sessions"].insert_one({
        "_id": session_hash(token),
        "userId": user_id,
        "createdAt": utc_now(),
        "expiresAt": utc_now() + SESSION_DURATION,
    })
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=os.getenv("CONVOY_COOKIE_SECURE", "").lower() == "true",
        samesite="lax",
        max_age=int(SESSION_DURATION.total_seconds()),
        path="/",
    )
    return {"user": user_view(database["users"].find_one({"_id": user_id})), "demoOnly": True}


@app.get("/api/auth/me")
def who_am_i(user: dict = Depends(require_user)):
    return {"user": user_view(user), "demoOnly": True}


@app.get("/api/auth/profile")
def get_customer_profile(user: dict = Depends(require_role("CUSTOMER"))):
    return customer_profile_view(user)


@app.put("/api/auth/profile")
def update_customer_profile(
    payload: CustomerProfileUpdate,
    user: dict = Depends(require_role("CUSTOMER")),
):
    name = payload.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Enter your full name.")

    updates = {"name": name, "updatedAt": utc_now()}
    aadhaar = re.sub(r"[\s-]", "", payload.aadhaar)
    pan = payload.pan.strip().upper()
    if aadhaar and not re.fullmatch(r"\d{12}", aadhaar):
        raise HTTPException(status_code=422, detail="Enter a 12-digit Aadhaar number.")
    if pan and not re.fullmatch(r"[A-Z]{5}\d{4}[A-Z]", pan):
        raise HTTPException(status_code=422, detail="Enter a valid 10-character PAN number.")

    if aadhaar or pan:
        cipher = pii_fernet()
        if aadhaar:
            updates["aadhaarCiphertext"] = cipher.encrypt(aadhaar.encode("ascii")).decode("ascii")
            updates["aadhaarLast4"] = aadhaar[-4:]
        if pan:
            updates["panCiphertext"] = cipher.encrypt(pan.encode("ascii")).decode("ascii")
            updates["panLast4"] = pan[-4:]

    database = get_database()
    database["users"].update_one({"_id": user["_id"]}, {"$set": updates})
    saved_user = database["users"].find_one({"_id": user["_id"]})
    return customer_profile_view(saved_user)


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        get_database()["sessions"].delete_one({"_id": session_hash(token)})
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax")
    return {"message": "Signed out."}


def list_group_documents(database, user: dict, city: str | None = None) -> list[dict]:
    query: dict = {"visibility": "PUBLIC", "status": {"$in": ["OPEN", "TARGET_REACHED", "QUOTING"]}}
    if city:
        query["city"] = city
    if user["role"] == "DEALER":
        if user.get("verificationStatus") != "VERIFIED":
            raise HTTPException(status_code=403, detail="A local admin must review this demo dealer before leads are available.")
        if not user.get("permissions", {}).get("sell", False):
            raise HTTPException(status_code=403, detail="An admin must grant the dealer sell permission before leads are available.")
        query["city"] = user.get("city")
        query["make"] = user.get("make")
        query["status"] = {"$in": ["TARGET_REACHED", "QUOTING"]}
    groups = list(database["groups"].find(query))
    own_ids = {
        group["_id"] for group in database["groups"].find(
            {"members.userId": user["_id"]}, {"_id": 1}
        )
    }
    if user["role"] == "CUSTOMER":
        groups.extend(database["groups"].find({
            "members.userId": user["_id"],
            "_id": {"$nin": list(own_ids)},
            "status": {"$in": ["OPEN", "TARGET_REACHED", "QUOTING", "CANCELLED", "EXPIRED"]},
        }))
    groups = [expire_group_if_due(database, group) for group in groups]
    unique = {
        group["_id"]: group for group in groups
        if group["status"] not in {"EXPIRED", "CANCELLED"}
    }
    return sorted(
        unique.values(),
        key=lambda group: (
            group["city"], group["model"], group["variant"],
            -group["memberCount"], group["createdAt"],
        ),
    )


@app.get("/api/groups")
def list_groups(
    city: str | None = Query(default=None, max_length=40),
    user: dict = Depends(require_user),
):
    if city and city not in CITIES:
        raise HTTPException(status_code=422, detail="Choose Gurgaon or Noida.")
    if user["role"] == "DEALER" and user.get("verificationStatus") != "VERIFIED":
        raise HTTPException(status_code=403, detail="An admin must approve this demo dealership before it can view group leads.")
    database = get_database()
    return [
        public_group(database, group, user["_id"])
        for group in list_group_documents(database, user, city)
    ]


@app.get("/api/orders")
def list_my_groups(user: dict = Depends(require_role("CUSTOMER"))):
    database = get_database()
    groups = list(database["groups"].find({"members.userId": user["_id"]}).sort("createdAt", -1))
    groups = [expire_group_if_due(database, group) for group in groups]
    return [public_group(database, group, user["_id"]) for group in groups]


def payment_record(amount: int, status: str, now: datetime) -> dict:
    return {
        "amount": amount,
        "status": status,
        "method": "DEMO_ONLY",
        "createdAt": as_iso(now),
    }


@app.post("/api/groups")
def create_group(payload: GroupCreate, user: dict = Depends(require_role("CUSTOMER"))):
    if not payload.first_name.strip():
        raise HTTPException(status_code=422, detail="Enter your first name.")
    validate_vehicle(payload.make, payload.model, payload.variant, payload.fuel_type, payload.transmission)
    if payload.city not in CITIES:
        raise HTTPException(status_code=422, detail="Choose Gurgaon or Noida.")
    if payload.purchase_window not in PURCHASE_WINDOWS:
        raise HTTPException(status_code=422, detail="Choose a supported purchase window.")
    if payload.minimum_member_count > payload.target_member_count:
        raise HTTPException(status_code=422, detail="Minimum buyer count cannot exceed the group target.")
    end_date = payload.purchase_end_date or (utc_now().date() + timedelta(days=14))
    if end_date <= utc_now().date():
        raise HTTPException(status_code=422, detail="Choose a future group closing date.")

    database = get_database()
    existing = database["groups"].find_one({
        "make": payload.make,
        "model": payload.model,
        "modelYear": payload.model_year,
        "variant": payload.variant,
        "fuelType": payload.fuel_type,
        "transmission": payload.transmission,
        "city": payload.city,
        "purchaseWindow": payload.purchase_window,
        "status": {"$in": ["OPEN", "TARGET_REACHED", "QUOTING"]},
        "visibility": "PUBLIC",
    })
    if existing:
        raise HTTPException(status_code=409, detail="A matching group already exists. Join it instead of creating a duplicate.")

    now = utc_now()
    group_id = str(uuid4())
    entry_payment = payment_record(ENTRY_FEE, "SIMULATED_PAID", now)
    member = {
        "userId": user["_id"],
        "name": payload.first_name.strip(),
        "status": "ACTIVE",
        "purchaseStatus": "NOT_SELECTED",
        "entryPayment": entry_payment,
        "successPayment": None,
        "selectedQuoteId": None,
        "payments": [entry_payment],
        "joinedAt": now,
    }
    group = {
        "_id": group_id,
        "organizerId": user["_id"],
        "make": payload.make,
        "model": payload.model,
        "modelYear": payload.model_year,
        "variant": payload.variant,
        "fuelType": payload.fuel_type,
        "transmission": payload.transmission,
        "city": payload.city,
        "targetMemberCount": payload.target_member_count,
        "minimumMemberCount": payload.minimum_member_count,
        "memberCount": 1,
        "members": [member],
        "waitlist": [],
        "purchaseWindow": payload.purchase_window,
        "purchaseEndDate": end_date.isoformat(),
        "visibility": "PUBLIC",
        "status": "OPEN",
        "events": [{"type": "GROUP_CREATED", "createdAt": now}],
        "createdAt": now,
        "updatedAt": now,
    }
    try:
        database["groups"].insert_one(group)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="A matching group was created at the same time. Join the existing group.") from exc
    database["users"].update_one(
        {"_id": user["_id"]},
        {"$set": {"name": payload.first_name.strip(), "updatedAt": now}},
    )
    audit(database, user, "GROUP", group_id, "CREATED", {"targetMemberCount": payload.target_member_count})
    return public_group(database, group, user["_id"])


def find_own_member(group: dict, user_id: str) -> dict | None:
    return next(
        (member for member in reversed(group.get("members", [])) if member.get("userId") == user_id),
        None,
    )


@app.post("/api/groups/{group_id}/join")
def join_group(group_id: str, user: dict = Depends(require_role("CUSTOMER"))):
    database = get_database()
    group = database["groups"].find_one({"_id": group_id, "visibility": "PUBLIC"})
    if not group:
        raise HTTPException(status_code=404, detail="Buying group not found.")
    group = expire_group_if_due(database, group)
    if group["status"] not in {"OPEN", "TARGET_REACHED", "QUOTING"}:
        raise HTTPException(status_code=409, detail="This group is no longer accepting members.")
    prior = find_own_member(group, user["_id"])
    if prior and prior["status"] == "ACTIVE":
        return public_group(database, group, user["_id"])
    if prior and prior["purchaseStatus"] == "PURCHASE_CONFIRMED":
        raise HTTPException(status_code=409, detail="This buyer has already confirmed a purchase in this group.")

    waitlisted = any(entry["userId"] == user["_id"] for entry in group.get("waitlist", []))
    waiting_ids = [entry["userId"] for entry in group.get("waitlist", [])]
    if group["memberCount"] < group["targetMemberCount"] and waiting_ids and waiting_ids[0] != user["_id"]:
        raise HTTPException(status_code=409, detail="A buyer is ahead of you on the waitlist. Refresh and try again.")
    if group["memberCount"] >= group["targetMemberCount"]:
        if waitlisted:
            return public_group(database, group, user["_id"])
        database["groups"].update_one(
            {"_id": group_id, "memberCount": {"$gte": group["targetMemberCount"]},
             "waitlist.userId": {"$ne": user["_id"]}},
            {"$push": {"waitlist": {"userId": user["_id"], "requestedAt": utc_now()}}},
        )
        refreshed = database["groups"].find_one({"_id": group_id})
        if any(entry["userId"] == user["_id"] for entry in refreshed.get("waitlist", [])):
            audit(database, user, "GROUP", group_id, "WAITLISTED")
            return public_group(database, refreshed, user["_id"])
        raise HTTPException(status_code=409, detail="This group changed while you were joining. Refresh and try again.")

    now = utc_now()
    entry_payment = payment_record(ENTRY_FEE, "SIMULATED_PAID", now)
    member = {
        "userId": user["_id"],
        "name": user.get("name", ""),
        "status": "ACTIVE",
        "purchaseStatus": "NOT_SELECTED",
        "entryPayment": entry_payment,
        "successPayment": None,
        "selectedQuoteId": None,
        "payments": [entry_payment],
        "joinedAt": now,
    }
    query = {
        "_id": group_id,
        "status": group["status"],
        "memberCount": {"$lt": group["targetMemberCount"]},
        "members": {"$not": {"$elemMatch": {
            "userId": user["_id"],
            "status": {"$in": ["ACTIVE", "PURCHASE_CONFIRMED"]},
        }}},
    }
    changes = {
        "$push": {
            "members": member,
            "events": {"type": "MEMBER_JOINED", "createdAt": now},
        },
        "$inc": {"memberCount": 1},
        "$set": {"updatedAt": now},
    }
    if waitlisted:
        changes["$pull"] = {"waitlist": {"userId": user["_id"]}}
    result = database["groups"].update_one(query, changes)
    if result.modified_count != 1:
        latest = database["groups"].find_one({"_id": group_id})
        existing_member = find_own_member(latest, user["_id"])
        if existing_member and existing_member["status"] == "ACTIVE":
            return public_group(database, latest, user["_id"])
        if latest["memberCount"] >= latest["targetMemberCount"]:
            return join_group(group_id, user)
        raise HTTPException(status_code=409, detail="This group changed while you were joining. Refresh and try again.")

    latest = database["groups"].find_one({"_id": group_id})
    if latest["memberCount"] >= latest["targetMemberCount"]:
        database["groups"].update_one(
            {"_id": group_id, "status": {"$in": ["OPEN", "TARGET_REACHED"]}},
            {"$set": {"status": "TARGET_REACHED", "updatedAt": utc_now()},
             "$push": {"events": {"type": "TARGET_REACHED", "createdAt": utc_now()}}},
        )
        latest = database["groups"].find_one({"_id": group_id})
    audit(database, user, "GROUP", group_id, "MEMBER_JOINED", {"entryFee": ENTRY_FEE})
    return public_group(database, latest, user["_id"])


@app.post("/api/groups/{group_id}/leave")
def leave_group(group_id: str, user: dict = Depends(require_role("CUSTOMER"))):
    database = get_database()
    group = database["groups"].find_one({"_id": group_id})
    if not group:
        raise HTTPException(status_code=404, detail="Buying group not found.")
    group = expire_group_if_due(database, group)
    member = find_own_member(group, user["_id"])
    if not member or member["status"] != "ACTIVE":
        raise HTTPException(status_code=409, detail="You are not an active member of this group.")
    if member.get("purchaseStatus") == "PURCHASE_CONFIRMED":
        raise HTTPException(status_code=409, detail="A confirmed purchase cannot be cancelled here.")
    now = utc_now()
    refund = payment_record(-ENTRY_FEE, "SIMULATED_REFUND", now)
    result = database["groups"].update_one(
        {"_id": group_id, "members": {"$elemMatch": {
            "userId": user["_id"], "status": "ACTIVE",
            "purchaseStatus": {"$ne": "PURCHASE_CONFIRMED"},
        }}},
        {"$set": {
            "members.$.status": "WITHDRAWN",
            "members.$.entryPayment.status": "SIMULATED_REFUNDED",
            "members.$.entryPayment.refundedAt": as_iso(now),
            "members.$.updatedAt": now,
            "status": "OPEN",
            "updatedAt": now,
        },
         "$inc": {"memberCount": -1},
         "$push": {"members.$.payments": refund,
                   "events": {"type": "MEMBER_LEFT_REFUND_SIMULATED", "createdAt": now}}},
    )
    if result.modified_count != 1:
        raise HTTPException(status_code=409, detail="Only an unconfirmed active member can leave this group.")
    database["quotes"].update_many(
        {"groupId": group_id, "status": "SUBMITTED"},
        {"$set": {"status": "INVALIDATED", "invalidatedAt": utc_now()}},
    )
    updated = database["groups"].find_one({"_id": group_id})
    audit(database, user, "GROUP", group_id, "MEMBER_LEFT", {"entryRefund": ENTRY_FEE})
    return public_group(database, updated, user["_id"])


@app.post("/api/groups/{group_id}/quotes")
def create_quote(
    group_id: str,
    payload: QuoteCreate,
    user: dict = Depends(require_dealer_permission("sell")),
):
    database = get_database()
    group = database["groups"].find_one({"_id": group_id})
    if not group:
        raise HTTPException(status_code=404, detail="Buying group not found.")
    group = expire_group_if_due(database, group)
    if group["make"] != user.get("make") or group["city"] != user.get("city"):
        raise HTTPException(status_code=403, detail="This dealership is not eligible for the group's make and delivery city.")
    if group["status"] not in {"TARGET_REACHED", "QUOTING"} or group["memberCount"] < group["targetMemberCount"]:
        raise HTTPException(status_code=409, detail="This group must reach its target before dealers can quote.")
    if payload.dealer_discount + payload.manufacturer_benefit > payload.ex_showroom:
        raise HTTPException(status_code=422, detail="Confirmed discounts cannot exceed the ex-showroom price.")
    if payload.group_benefit_total and not payload.group_benefit_description.strip():
        raise HTTPException(status_code=422, detail="Describe the group-level benefit.")
    if payload.other_charges and not payload.other_charges_explanation.strip():
        raise HTTPException(status_code=422, detail="Explain any other on-road charges.")
    if payload.other_taxes_amount and not payload.other_taxes_explanation.strip():
        raise HTTPException(status_code=422, detail="Explain any additional taxes or statutory charges.")
    if not payload.vehicle_colour.strip():
        raise HTTPException(status_code=422, detail="Enter the quoted vehicle colour.")
    if not payload.dealer_location.strip():
        raise HTTPException(status_code=422, detail="Enter the dealership outlet location.")
    if not payload.salesperson_name.strip() or not payload.manager_name.strip():
        raise HTTPException(status_code=422, detail="Enter the salesperson and manager names.")
    if not payload.authorization_reference.strip():
        raise HTTPException(status_code=422, detail="Enter the dealership authorisation reference.")
    if payload.exchange_bonus and not payload.exchange_condition.strip():
        raise HTTPException(status_code=422, detail="State the exchange bonus eligibility condition.")
    if payload.corporate_benefit and not payload.corporate_condition.strip():
        raise HTTPException(status_code=422, detail="State the corporate benefit eligibility condition.")
    if payload.stock_status not in STOCK_STATUSES:
        raise HTTPException(status_code=422, detail="Choose a supported stock status.")
    if payload.insurance_type == "DEALER" and not payload.insurance_provider.strip():
        raise HTTPException(status_code=422, detail="Name the dealer-provided insurance provider.")
    if payload.quote_valid_until <= utc_now().date():
        raise HTTPException(status_code=422, detail="Quote validity must end on a future date.")

    quantity = group["memberCount"]
    allocated_group_benefit = (payload.group_benefit_total + quantity // 2) // quantity
    confirmed_deductions = (
        payload.dealer_discount + payload.manufacturer_benefit + allocated_group_benefit
    )
    if confirmed_deductions > payload.ex_showroom:
        raise HTTPException(status_code=422, detail="Confirmed discounts and group benefits cannot exceed the ex-showroom price.")
    on_road_total = (
        payload.ex_showroom - confirmed_deductions
        + payload.insurance_amount + payload.registration_amount + payload.tcs_amount
        + payload.road_tax_amount + payload.other_taxes_amount
        + payload.fastag_amount + payload.hypothecation_amount
        + payload.accessories_amount + payload.handling_amount + payload.logistics_amount
        + payload.other_charges
    )
    now = utc_now()
    latest = database["quotes"].find_one(
        {"groupId": group_id, "dealerId": user["_id"]},
        sort=[("revision", -1)],
    )
    revision = latest["revision"] + 1 if latest else 1
    if latest:
        database["quotes"].update_one(
            {"_id": latest["_id"], "status": "SUBMITTED"},
            {"$set": {"status": "REVISED"}},
        )
    quote_id = str(uuid4())
    quote = {
        "_id": quote_id,
        "quoteReference": f"CV-{now:%y%m%d}-{quote_id[:6].upper()}",
        "groupId": group_id,
        "dealerId": user["_id"],
        "dealerName": user["dealerName"],
        "dealerDemoApprovalStatus": "APPROVED_FOR_DEMO",
        "dealerLocation": payload.dealer_location.strip(),
        "salespersonName": payload.salesperson_name.strip(),
        "managerName": payload.manager_name.strip(),
        "authorizationReference": payload.authorization_reference.strip(),
        "vehicleVariant": group["variant"],
        "vehicleColour": payload.vehicle_colour.strip(),
        "revision": revision,
        "status": "SUBMITTED",
        "quantity": quantity,
        "exShowroom": payload.ex_showroom,
        "gstIncludedAmount": payload.gst_included_amount,
        "dealerDiscount": payload.dealer_discount,
        "manufacturerBenefit": payload.manufacturer_benefit,
        "exchangeBonus": payload.exchange_bonus,
        "exchangeCondition": payload.exchange_condition.strip(),
        "corporateBenefit": payload.corporate_benefit,
        "corporateCondition": payload.corporate_condition.strip(),
        "insuranceAmount": payload.insurance_amount,
        "insuranceType": payload.insurance_type,
        "insuranceProvider": payload.insurance_provider.strip(),
        "registrationAmount": payload.registration_amount,
        "roadTaxAmount": payload.road_tax_amount,
        "otherTaxesAmount": payload.other_taxes_amount,
        "otherTaxesExplanation": payload.other_taxes_explanation.strip(),
        "tcsAmount": payload.tcs_amount,
        "fastagAmount": payload.fastag_amount,
        "hypothecationAmount": payload.hypothecation_amount,
        "accessoriesAmount": payload.accessories_amount,
        "handlingAmount": payload.handling_amount,
        "logisticsAmount": payload.logistics_amount,
        "otherCharges": payload.other_charges,
        "otherChargesExplanation": payload.other_charges_explanation.strip(),
        "groupBenefitTotal": payload.group_benefit_total,
        "groupBenefitPerVehicle": allocated_group_benefit,
        "groupBenefitDescription": payload.group_benefit_description.strip(),
        "onRoadTotal": on_road_total,
        "groupOnRoadTotal": on_road_total * quantity,
        "deliveryEstimate": payload.delivery_estimate.strip(),
        "stockStatus": payload.stock_status,
        "validUntil": datetime.combine(payload.quote_valid_until, time.max, tzinfo=timezone.utc),
        "terms": payload.terms.strip(),
        "submittedAt": now,
    }
    try:
        database["quotes"].insert_one(quote)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="A quote revision was submitted at the same time. Refresh and retry.") from exc
    database["groups"].update_one(
        {"_id": group_id, "status": {"$in": ["TARGET_REACHED", "QUOTING"]}},
        {"$set": {"status": "QUOTING", "updatedAt": now},
         "$push": {"events": {"type": "QUOTE_SUBMITTED", "createdAt": now}}},
    )
    audit(database, user, "GROUP", group_id, "QUOTE_SUBMITTED", {"quoteId": quote_id, "revision": revision})
    return public_quote(quote)


@app.post("/api/groups/{group_id}/selection")
def select_quote(
    group_id: str,
    payload: QuoteSelection,
    user: dict = Depends(require_role("CUSTOMER")),
):
    database = get_database()
    group = database["groups"].find_one({"_id": group_id})
    if not group:
        raise HTTPException(status_code=404, detail="Buying group not found.")
    group = expire_group_if_due(database, group)
    member = find_own_member(group, user["_id"])
    if not member or member["status"] != "ACTIVE":
        raise HTTPException(status_code=403, detail="Only an active group member can select a quote.")
    if member.get("purchaseStatus") == "PURCHASE_CONFIRMED":
        raise HTTPException(status_code=409, detail="A purchase has already been confirmed for this membership.")
    quote = next(
        (quote for quote in active_quotes(database, group_id) if quote["id"] == payload.quote_id),
        None,
    )
    if not quote:
        raise HTTPException(status_code=404, detail="The selected submitted quote is expired or unavailable.")
    now = utc_now()
    payment = payment_record(SUCCESS_FEE, "SIMULATED_PAID", now)
    result = database["groups"].update_one(
        {"_id": group_id, "members": {"$elemMatch": {
            "userId": user["_id"], "status": "ACTIVE",
            "purchaseStatus": {"$ne": "PURCHASE_CONFIRMED"},
        }}},
        {"$set": {
            "members.$.purchaseStatus": "PURCHASE_CONFIRMED",
            "members.$.selectedQuoteId": payload.quote_id,
            "members.$.successPayment": payment,
            "members.$.updatedAt": now,
            "updatedAt": now,
        },
         "$push": {"members.$.payments": payment,
                   "events": {"type": "BUYER_SELECTED_QUOTE", "createdAt": now}}},
    )
    if result.modified_count != 1:
        raise HTTPException(status_code=409, detail="This membership has already changed.")
    audit(database, user, "GROUP", group_id, "BUYER_SELECTED_QUOTE", {"quoteId": payload.quote_id})
    updated = database["groups"].find_one({"_id": group_id})
    return public_group(database, updated, user["_id"])


@app.post("/api/groups/{group_id}/ratings")
def rate_purchase(
    group_id: str,
    payload: RatingCreate,
    user: dict = Depends(require_role("CUSTOMER")),
):
    database = get_database()
    group = database["groups"].find_one({"_id": group_id})
    if not group:
        raise HTTPException(status_code=404, detail="Buying group not found.")
    member = find_own_member(group, user["_id"])
    if (
        not member
        or member.get("status") != "ACTIVE"
        or member.get("purchaseStatus") != "PURCHASE_CONFIRMED"
        or member.get("selectedQuoteId") != payload.quote_id
    ):
        raise HTTPException(status_code=403, detail="Only a buyer who confirmed this exact quote can rate its dealer.")
    quote = database["quotes"].find_one({
        "_id": payload.quote_id,
        "groupId": group_id,
        "dealerDemoApprovalStatus": "APPROVED_FOR_DEMO",
    })
    if not quote:
        raise HTTPException(status_code=404, detail="The confirmed dealer quotation could not be found.")
    now = utc_now()
    rating = {
        "_id": str(uuid4()),
        "groupId": group_id,
        "userId": user["_id"],
        "dealerId": quote["dealerId"],
        "dealerName": quote["dealerName"],
        "quoteId": quote["_id"],
        "rating": payload.rating,
        "comment": payload.comment.strip(),
        "vehicle": f'{group["modelYear"]} {group["make"]} {group["model"]} {group["variant"]}',
        "createdAt": now,
    }
    try:
        database["ratings"].insert_one(rating)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="You have already rated this purchase.") from exc
    updated = database["groups"].update_one(
        {"_id": group_id, "members": {"$elemMatch": {
            "userId": user["_id"],
            "selectedQuoteId": payload.quote_id,
            "purchaseStatus": "PURCHASE_CONFIRMED",
        }}},
        {"$set": {"members.$.rating": {
            "rating": payload.rating,
            "comment": payload.comment.strip(),
            "createdAt": now,
        }}},
    )
    if updated.modified_count != 1:
        database["ratings"].delete_one({"_id": rating["_id"]})
        raise HTTPException(status_code=409, detail="The confirmed purchase changed before the rating could be saved.")
    audit(database, user, "RATING", rating["_id"], "PURCHASE_RATED", {"dealerId": quote["dealerId"]})
    return {
        "id": rating["_id"],
        "rating": rating["rating"],
        "comment": rating["comment"],
        "createdAt": as_iso(now),
    }


@app.get("/api/dealer/quotes")
def dealer_quotes(user: dict = Depends(require_dealer_permission("sell"))):
    database = get_database()
    latest_by_group = {}
    for quote in database["quotes"].find({"dealerId": user["_id"], "status": {"$in": ["SUBMITTED", "REVISED"]}}):
        current = latest_by_group.get(quote["groupId"])
        if current is None or quote["revision"] > current["revision"]:
            latest_by_group[quote["groupId"]] = quote
    return [public_quote(quote) | {"groupId": quote["groupId"]} for quote in latest_by_group.values()]


def inventory_view(item: dict) -> dict:
    return {
        "id": item["_id"],
        "model": item["model"],
        "modelYear": item["modelYear"],
        "variant": item["variant"],
        "fuelType": item["fuelType"],
        "transmission": item["transmission"],
        "colour": item["colour"],
        "city": item["city"],
        "quantity": item["quantity"],
        "stockStatus": item["stockStatus"],
        "expectedDelivery": item.get("expectedDelivery", ""),
        "updatedAt": as_iso(item["updatedAt"]),
    }


@app.get("/api/dealer/inventory")
def dealer_inventory(user: dict = Depends(require_dealer_permission("inventory"))):
    database = get_database()
    items = database["inventory"].find({"dealerId": user["_id"]}).sort("updatedAt", -1)
    return [inventory_view(item) for item in items]


@app.post("/api/dealer/inventory")
def add_inventory(
    payload: InventoryCreate,
    user: dict = Depends(require_dealer_permission("inventory")),
):
    if payload.city != user.get("city"):
        raise HTTPException(status_code=403, detail="Inventory can only be listed for your approved dealership city.")
    validate_vehicle(user.get("make", ""), payload.model, payload.variant, payload.fuel_type, payload.transmission)
    now = utc_now()
    item = {
        "_id": str(uuid4()),
        "dealerId": user["_id"],
        "dealerName": user.get("dealerName", ""),
        "make": user["make"],
        "model": payload.model,
        "modelYear": payload.model_year,
        "variant": payload.variant.strip(),
        "fuelType": payload.fuel_type,
        "transmission": payload.transmission,
        "colour": payload.colour.strip(),
        "city": payload.city,
        "quantity": payload.quantity,
        "stockStatus": payload.stock_status,
        "expectedDelivery": payload.expected_delivery.strip(),
        "createdAt": now,
        "updatedAt": now,
    }
    database = get_database()
    database["inventory"].insert_one(item)
    audit(database, user, "INVENTORY", item["_id"], "INVENTORY_ADDED", {
        "model": item["model"],
        "quantity": item["quantity"],
        "stockStatus": item["stockStatus"],
    })
    return inventory_view(item)


@app.put("/api/dealer/inventory/{inventory_id}")
def update_inventory(
    inventory_id: str,
    payload: InventoryCreate,
    user: dict = Depends(require_dealer_permission("inventory")),
):
    database = get_database()
    existing = database["inventory"].find_one({"_id": inventory_id, "dealerId": user["_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Inventory item not found for this dealer.")
    if payload.city != user.get("city"):
        raise HTTPException(status_code=403, detail="Inventory can only be listed for your approved dealership city.")
    validate_vehicle(user.get("make", ""), payload.model, payload.variant, payload.fuel_type, payload.transmission)
    now = utc_now()
    updates = {
        "model": payload.model,
        "modelYear": payload.model_year,
        "variant": payload.variant.strip(),
        "fuelType": payload.fuel_type,
        "transmission": payload.transmission,
        "colour": payload.colour.strip(),
        "city": payload.city,
        "quantity": payload.quantity,
        "stockStatus": payload.stock_status,
        "expectedDelivery": payload.expected_delivery.strip(),
        "updatedAt": now,
    }
    database["inventory"].update_one(
        {"_id": inventory_id, "dealerId": user["_id"]},
        {"$set": updates},
    )
    audit(database, user, "INVENTORY", inventory_id, "INVENTORY_UPDATED", {
        "model": updates["model"],
        "quantity": updates["quantity"],
        "stockStatus": updates["stockStatus"],
    })
    return inventory_view(database["inventory"].find_one({"_id": inventory_id}))


@app.delete("/api/dealer/inventory/{inventory_id}")
def delete_inventory(
    inventory_id: str,
    user: dict = Depends(require_dealer_permission("inventory")),
):
    database = get_database()
    item = database["inventory"].find_one({"_id": inventory_id, "dealerId": user["_id"]})
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found for this dealer.")
    database["inventory"].delete_one({"_id": inventory_id, "dealerId": user["_id"]})
    audit(database, user, "INVENTORY", inventory_id, "INVENTORY_REMOVED")
    return {"message": "Inventory item removed."}


@app.get("/api/dealer/payments")
def dealer_payment_summary(user: dict = Depends(require_dealer_permission("payments"))):
    database = get_database()
    groups = database["groups"].find({
        "make": user.get("make"),
        "city": user.get("city"),
    }).sort("createdAt", -1)
    summary = []
    for group in groups:
        members = [
            member for member in group.get("members", [])
            if member.get("status") == "ACTIVE"
        ]
        if not members:
            continue
        summary.append({
            "groupId": group["_id"],
            "vehicle": f'{group["modelYear"]} {group["make"]} {group["model"]} {group["variant"]}',
            "city": group["city"],
            "buyerCount": len(members),
            "entryFeePaidCount": sum(
                (member.get("entryPayment") or {}).get("status") == "SIMULATED_PAID"
                for member in members
            ),
            "purchaseFeePaidCount": sum(
                (member.get("successPayment") or {}).get("status") == "SIMULATED_PAID"
                for member in members
            ),
            "paymentDataIsSimulated": True,
        })
    return summary


@app.get("/api/dealer/ratings")
def dealer_ratings(user: dict = Depends(require_dealer_permission("ratings"))):
    database = get_database()
    ratings = list(database["ratings"].find({"dealerId": user["_id"]}).sort("createdAt", -1))
    return {
        "average": round(sum(item["rating"] for item in ratings) / len(ratings), 1) if ratings else None,
        "count": len(ratings),
        "ratings": [
            {
                "id": item["_id"],
                "rating": item["rating"],
                "comment": item.get("comment", ""),
                "vehicle": item.get("vehicle", ""),
                "createdAt": as_iso(item["createdAt"]),
            }
            for item in ratings
        ],
    }


def issue_view(issue: dict, include_reporter: bool = False) -> dict:
    result = {
        "id": issue["_id"],
        "category": issue["category"],
        "groupId": issue.get("groupId", ""),
        "description": issue["description"],
        "status": issue["status"],
        "adminNote": issue.get("adminNote", ""),
        "createdAt": as_iso(issue["createdAt"]),
        "updatedAt": as_iso(issue["updatedAt"]),
    }
    if include_reporter:
        result.update({
            "reporterRole": issue["reporterRole"],
            "reporterName": issue.get("reporterName", ""),
            "reporterPhoneMasked": issue.get("reporterPhoneMasked", ""),
        })
    return result


@app.get("/api/issues")
def my_issues(user: dict = Depends(require_user)):
    if user["role"] == "DEALER":
        if user.get("verificationStatus") != "VERIFIED" or not user.get("permissions", {}).get("issues", False):
            raise HTTPException(status_code=403, detail="An admin must approve the dealer and grant issues access.")
    database = get_database()
    items = database["issues"].find({"reporterId": user["_id"]}).sort("createdAt", -1)
    return [issue_view(item) for item in items]


@app.post("/api/issues")
def create_issue(payload: IssueCreate, user: dict = Depends(require_user)):
    if user["role"] == "ADMIN":
        raise HTTPException(status_code=403, detail="Admins review issues; only customers and dealers can report them.")
    if user["role"] == "DEALER":
        if user.get("verificationStatus") != "VERIFIED" or not user.get("permissions", {}).get("issues", False):
            raise HTTPException(status_code=403, detail="An admin must approve the dealer and grant issues access.")
    database = get_database()
    group = None
    if payload.group_id:
        group = database["groups"].find_one({"_id": payload.group_id})
        if not group:
            raise HTTPException(status_code=404, detail="Buying group not found.")
        if user["role"] == "CUSTOMER":
            membership = own_membership(group, user["_id"])
            if not membership:
                raise HTTPException(status_code=403, detail="You can only report an issue for your own buying group.")
        elif group.get("make") != user.get("make") or group.get("city") != user.get("city"):
            raise HTTPException(status_code=403, detail="You can only report an issue for a group in your approved make and city.")
    now = utc_now()
    issue = {
        "_id": str(uuid4()),
        "reporterId": user["_id"],
        "reporterRole": user["role"],
        "reporterName": user.get("dealerName") or user.get("name") or "",
        "reporterPhoneMasked": f'******{user["phone"][-4:]}',
        "dealerId": user["_id"] if user["role"] == "DEALER" else None,
        "category": payload.category,
        "groupId": payload.group_id or "",
        "description": payload.description.strip(),
        "status": "OPEN",
        "adminNote": "",
        "createdAt": now,
        "updatedAt": now,
    }
    if user["role"] == "CUSTOMER" and group:
        membership = own_membership(group, user["_id"])
        selected_quote_id = membership.get("selectedQuoteId") if membership else None
        selected_quote = database["quotes"].find_one({"_id": selected_quote_id}) if selected_quote_id else None
        if selected_quote:
            issue["dealerId"] = selected_quote["dealerId"]
    database["issues"].insert_one(issue)
    audit(database, user, "ISSUE", issue["_id"], "ISSUE_REPORTED", {"category": issue["category"]})
    return issue_view(issue)


@app.get("/api/admin/dealers")
def admin_dealers(user: dict = Depends(require_role("ADMIN"))):
    dealers = get_database()["users"].find({"role": "DEALER"}).sort("updatedAt", -1)
    return [
        {
            "id": dealer["_id"],
            "dealerName": dealer.get("dealerName", ""),
            "phone": dealer["phone"],
            "city": dealer.get("city", ""),
            "make": dealer.get("make", ""),
            "verificationStatus": dealer.get("verificationStatus", "PENDING"),
            "permissions": {
                key: bool(dealer.get("permissions", {}).get(key, False))
                for key in DEALER_PERMISSION_KEYS
            },
        }
        for dealer in dealers
    ]


@app.post("/api/admin/dealers")
def add_dealer(
    payload: AdminDealerCreate,
    user: dict = Depends(require_role("ADMIN")),
):
    phone = clean_phone(payload.phone)
    if payload.city not in CITIES:
        raise HTTPException(status_code=422, detail="Choose Gurgaon or Noida.")
    if payload.make not in CATALOG:
        raise HTTPException(status_code=422, detail="Choose a make from the supported vehicle directory.")
    if not payload.dealer_name.strip():
        raise HTTPException(status_code=422, detail="Enter the dealership name.")
    database = get_database()
    dealer_id = f"DEALER:{phone}"
    if database["users"].find_one({"_id": dealer_id}):
        raise HTTPException(status_code=409, detail="A dealer account already exists for this phone number.")
    now = utc_now()
    dealer = {
        "_id": dealer_id,
        "phone": phone,
        "role": "DEALER",
        "dealerName": payload.dealer_name.strip(),
        "city": payload.city,
        "make": payload.make,
        "verificationStatus": "PENDING",
        "permissions": DEFAULT_DEALER_PERMISSIONS.copy(),
        "createdBy": user["_id"],
        "createdAt": now,
        "updatedAt": now,
    }
    database["users"].insert_one(dealer)
    audit(database, user, "DEALER", dealer_id, "ADMIN_ADDED_PENDING")
    return {
        "id": dealer_id,
        "dealerName": dealer["dealerName"],
        "phone": phone,
        "city": dealer["city"],
        "make": dealer["make"],
        "verificationStatus": dealer["verificationStatus"],
    }


@app.post("/api/admin/dealers/{dealer_user_id}/verification")
def verify_dealer(
    dealer_user_id: str,
    payload: DealerVerification,
    user: dict = Depends(require_role("ADMIN")),
):
    database = get_database()
    dealer = database["users"].find_one({"_id": dealer_user_id, "role": "DEALER"})
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer account not found.")
    now = utc_now()
    database["users"].update_one(
        {"_id": dealer_user_id, "role": "DEALER"},
        {"$set": {
            "verificationStatus": payload.status,
            "verificationReason": payload.reason.strip(),
            "verifiedAt": now if payload.status == "VERIFIED" else None,
            "updatedAt": now,
            **({"permissions": DEFAULT_DEALER_PERMISSIONS.copy()} if payload.status == "REJECTED" else {}),
        }},
    )
    audit(database, user, "DEALER", dealer_user_id, f"VERIFICATION_{payload.status}")
    return user_view(database["users"].find_one({"_id": dealer_user_id}))


@app.post("/api/admin/dealers/{dealer_user_id}/permissions")
def update_dealer_permissions(
    dealer_user_id: str,
    payload: DealerPermissionUpdate,
    user: dict = Depends(require_role("ADMIN")),
):
    database = get_database()
    dealer = database["users"].find_one({"_id": dealer_user_id, "role": "DEALER"})
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer account not found.")
    permissions = {key: bool(getattr(payload, key)) for key in DEALER_PERMISSION_KEYS}
    if dealer.get("verificationStatus") != "VERIFIED" and any(permissions.values()):
        raise HTTPException(status_code=409, detail="Approve the dealer first. Feature permissions can only be granted after review.")
    database["users"].update_one(
        {"_id": dealer_user_id},
        {"$set": {"permissions": permissions, "updatedAt": utc_now()}},
    )
    audit(database, user, "DEALER", dealer_user_id, "PERMISSIONS_UPDATED", permissions)
    return user_view(database["users"].find_one({"_id": dealer_user_id}))


@app.get("/api/admin/groups")
def admin_groups(user: dict = Depends(require_role("ADMIN"))):
    database = get_database()
    groups = list(database["groups"].find({}).sort("createdAt", -1))
    return [public_group(database, group, user["_id"]) for group in groups]


@app.get("/api/admin/inventory")
def admin_inventory(user: dict = Depends(require_role("ADMIN"))):
    database = get_database()
    items = database["inventory"].find({}).sort("updatedAt", -1)
    result = []
    for item in items:
        dealer = database["users"].find_one({"_id": item["dealerId"]}, {"phone": 1})
        result.append(inventory_view(item) | {
            "dealerId": item["dealerId"],
            "dealerName": item.get("dealerName", ""),
            "make": item.get("make", ""),
            "dealerPhoneMasked": f'******{dealer.get("phone", "****")[-4:]}' if dealer else "",
        })
    return result


@app.get("/api/admin/ratings")
def admin_ratings(user: dict = Depends(require_role("ADMIN"))):
    database = get_database()
    ratings = list(database["ratings"].find({}).sort("createdAt", -1))
    return {
        "average": round(sum(item["rating"] for item in ratings) / len(ratings), 1) if ratings else None,
        "count": len(ratings),
        "ratings": [
            {
                "id": item["_id"],
                "dealerName": item.get("dealerName", ""),
                "vehicle": item.get("vehicle", ""),
                "rating": item["rating"],
                "comment": item.get("comment", ""),
                "createdAt": as_iso(item["createdAt"]),
            }
            for item in ratings
        ],
    }


@app.get("/api/admin/issues")
def admin_issues(user: dict = Depends(require_role("ADMIN"))):
    database = get_database()
    issues = database["issues"].find({}).sort("createdAt", -1)
    return [issue_view(issue, include_reporter=True) for issue in issues]


@app.get("/api/admin/audit")
def admin_audit(
    limit: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(require_role("ADMIN")),
):
    database = get_database()
    logs = database["audit_logs"].find({}).sort("createdAt", -1).limit(limit)
    return [
        {
            "id": str(log["_id"]),
            "actorFingerprint": log.get("actorHash", "")[:12],
            "entityType": log.get("entityType", ""),
            "entityId": log.get("entityId", ""),
            "action": log.get("action", ""),
            "details": log.get("details", {}),
            "createdAt": as_iso(log.get("createdAt")),
        }
        for log in logs
    ]


@app.post("/api/admin/issues/{issue_id}")
def update_issue(
    issue_id: str,
    payload: IssueUpdate,
    user: dict = Depends(require_role("ADMIN")),
):
    database = get_database()
    issue = database["issues"].find_one({"_id": issue_id})
    if not issue:
        raise HTTPException(status_code=404, detail="Issue ticket not found.")
    now = utc_now()
    database["issues"].update_one(
        {"_id": issue_id},
        {"$set": {
            "status": payload.status,
            "adminNote": payload.admin_note.strip(),
            "updatedAt": now,
        }},
    )
    audit(database, user, "ISSUE", issue_id, "ISSUE_STATUS_UPDATED", {"status": payload.status})
    updated = database["issues"].find_one({"_id": issue_id})
    return issue_view(updated, include_reporter=True)


@app.get("/api/admin/deals")
def admin_deals(user: dict = Depends(require_role("ADMIN"))):
    database = get_database()
    result = []
    for group in database["groups"].find({}).sort("createdAt", -1):
        group = expire_group_if_due(database, group)
        quotes = [
            public_quote(quote) | {"status": quote.get("status", "UNKNOWN")}
            for quote in database["quotes"].find({"groupId": group["_id"]}).sort("revision", -1)
        ]
        result.append({
            "id": group["_id"],
            "vehicle": f'{group["modelYear"]} {group["make"]} {group["model"]} {group["variant"]}',
            "fuelType": group["fuelType"],
            "transmission": group["transmission"],
            "city": group["city"],
            "memberCount": group["memberCount"],
            "targetMemberCount": group["targetMemberCount"],
            "status": group["status"],
            "createdAt": as_iso(group["createdAt"]),
            "quotes": quotes,
        })
    return result


@app.get("/api/admin/payments")
def admin_payments(user: dict = Depends(require_role("ADMIN"))):
    database = get_database()
    groups = list(database["groups"].find({}))
    user_ids = list({
        member["userId"]
        for group in groups
        for member in group.get("members", [])
    })
    users = {
        account["_id"]: account
        for account in database["users"].find({"_id": {"$in": user_ids}})
    }
    entries = []
    for group in groups:
        vehicle = f'{group["modelYear"]} {group["make"]} {group["model"]} {group["variant"]}'
        for member in group.get("members", []):
            events = list(member.get("payments", []))
            entry_payment = member.get("entryPayment")
            success_payment = member.get("successPayment")
            if entry_payment and not any(event.get("amount") == ENTRY_FEE for event in events):
                events.append(entry_payment | {"kind": "ENTRY_FEE"})
            if success_payment and not any(event.get("amount") == SUCCESS_FEE for event in events):
                events.append(success_payment | {"kind": "PURCHASE_SUCCESS_FEE"})
            account = users.get(member["userId"], {})
            for index, event in enumerate(events):
                amount = event.get("amount", 0)
                kind = event.get("kind") or (
                    "ENTRY_FEE_REFUND" if amount < 0
                    else "PURCHASE_SUCCESS_FEE" if amount == SUCCESS_FEE
                    else "ENTRY_FEE"
                )
                entries.append({
                    "id": f'{group["_id"]}:{member["userId"]}:{index}',
                    "groupId": group["_id"],
                    "vehicle": vehicle,
                    "city": group["city"],
                    "buyerName": member.get("name") or account.get("name", "Customer"),
                    "buyerPhoneMasked": f'******{account.get("phone", "****")[-4:]}',
                    "kind": kind,
                    "amount": amount,
                    "status": event.get("status", "UNKNOWN"),
                    "method": event.get("method", "DEMO_ONLY"),
                    "createdAt": event.get("createdAt"),
                })
    entries.sort(key=lambda entry: entry.get("createdAt") or "", reverse=True)
    return {
        "entries": entries,
        "summary": {
            "recordCount": len(entries),
            "entryFeeCount": sum(entry["kind"] == "ENTRY_FEE" for entry in entries),
            "refundCount": sum(entry["kind"] == "ENTRY_FEE_REFUND" for entry in entries),
            "purchaseFeeCount": sum(entry["kind"] == "PURCHASE_SUCCESS_FEE" for entry in entries),
            "netRecordedAmount": sum(entry["amount"] for entry in entries),
            "realPaymentsCollected": False,
        },
    }


@app.get("/api/admin/access")
def admin_access(user: dict = Depends(require_role("ADMIN"))):
    database = get_database()
    now = utc_now()
    accounts = []
    for account in database["users"].find({}).sort("updatedAt", -1):
        active_sessions = database["sessions"].count_documents({
            "userId": account["_id"],
            "expiresAt": {"$gt": now},
        })
        accounts.append({
            "id": account["_id"],
            "role": account["role"],
            "displayName": account.get("dealerName") or account.get("name") or "",
            "phoneMasked": f'******{account["phone"][-4:]}',
            "city": account.get("city", ""),
            "make": account.get("make", ""),
            "verificationStatus": account.get("verificationStatus", ""),
            "permissions": {
                key: bool(account.get("permissions", {}).get(key, False))
                for key in DEALER_PERMISSION_KEYS
            } if account["role"] == "DEALER" else {},
            "activeSessions": active_sessions,
            "updatedAt": as_iso(account.get("updatedAt")),
        })
    return {
        "accounts": accounts,
        "summary": {
            "accountCount": len(accounts),
            "dealerCount": sum(account["role"] == "DEALER" for account in accounts),
            "customerCount": sum(account["role"] == "CUSTOMER" for account in accounts),
            "activeSessionCount": sum(account["activeSessions"] for account in accounts),
        },
    }


@app.post("/api/admin/users/{user_id}/revoke-sessions")
def revoke_user_sessions(
    user_id: str,
    user: dict = Depends(require_role("ADMIN")),
):
    database = get_database()
    account = database["users"].find_one({"_id": user_id})
    if not account:
        raise HTTPException(status_code=404, detail="Account not found.")
    result = database["sessions"].delete_many({"userId": user_id})
    audit(database, user, "USER", user_id, "SESSIONS_REVOKED", {"sessionCount": result.deleted_count})
    return {"message": "All account sessions revoked.", "revokedSessionCount": result.deleted_count}


@app.get("/")
def home():
    return FileResponse(ROOT / "portal.html")


app.mount("/", StaticFiles(directory=str(ROOT), html=True), name="static")


def main():
    parser = argparse.ArgumentParser(description="Run the local Convoy buyer, dealer, and admin demo.")
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"), help="Bind address (default: localhost only).")
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8791")), help="Port to listen on (default: 8791).")
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
