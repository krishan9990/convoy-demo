# Convoy - local group car-buying MVP

Convoy groups buyers by exact make, model, model year, variant/trim, fuel type, transmission, delivery city, and purchase window. The customer workspace creates or joins a group, tracks its buyer target and waitlist, follows a group activity timeline, compares itemized dealer quotations, confirms a purchase, rates the selected dealer after confirmation, and reports support issues. Approved demo dealerships only receive the features explicitly enabled by an admin: selling/eligible leads, aggregate group payment status, ratings, support issues, and dealer-entered inventory. Dealers can search eligible leads and filter by whether quotations have been submitted. Admins can add/review dealers, grant or revoke each permission, inspect every group and quote revision, review inventory, ratings and issue tickets, view the full simulated payment/refund ledger and audit history, export admin reports as CSV, and revoke account sessions.

The make/model directory follows the attached India passenger-vehicle directory. It is not a live inventory feed. Fuel, transmission, variant, model, and dealer availability must be confirmed directly with an authorised dealer before acting on a group or quotation.

## Run locally

Start the MongoDB service from the project root (skip if it is already running):

```powershell
docker compose up -d mongo
```

In another PowerShell window, from the project root:

```powershell
$env:MONGO_URI = "mongodb://127.0.0.1:27017"
$env:MONGO_DB = "convoy"
$env:CONVOY_ADMIN_PHONE = "<your-admin-mobile>"
$env:CONVOY_DEMO_OTP = "<your-six-digit-demo-otp>"
python .\bulk-buy\server.py
```

Open http://127.0.0.1:8791. The server binds to localhost by default.

## Demo sign-in and roles

- Choose **Customer**, **Dealer**, or **Admin** and enter a 10-digit Indian mobile number.
- Configure a six-digit `CONVOY_DEMO_OTP` and an admin mobile in `CONVOY_ADMIN_PHONE` before starting the server. No SMS is sent; the OTP is returned by the demo request endpoint. Use the configured mobile for admin sign-in; profiles and permissions remain separate by role.
- Customers create or join one group per selected vehicle specification, choose a target of 3-20 buyers (default 5), and select Gurgaon or Noida.
- Dealers provide their dealership name, city, and represented make. The admin must approve the demo dealer, then separately grant each feature permission before those APIs and screens become available.
- The admin can add dealers as pending accounts, approve/reject access, grant/revoke selling, aggregate payments, ratings, issue, and inventory permissions, inspect all deals and quotes, review inventory and ratings, resolve issue tickets, view fee/refund records, and revoke user sessions.
- A dealer submits written prices and itemized on-road charges, including registration/RTO, road tax, TCS, other statutory charges, FASTag, and hypothecation. GST entered as included in ex-showroom is informational and is not added twice. Conditional exchange/corporate benefits are kept separate from the server-calculated on-road total.
- Customer quote cards include the quoted trim and colour, outlet location, salesperson, manager, dealer-supplied authorisation reference, quote status, and complete on-road breakdown. Dealer references and demo approval are not proof of legal authorisation.
- Dealer lead responses show only group vehicle details and aggregate buyer counts; buyer names and phone numbers are not shown.
- Dealer payment access shows only aggregate simulated payment counts per eligible group. Individual customer payment records are admin-only.
- Dealers can add, edit, and remove their own demo inventory; customers should not interpret it as confirmed live stock or a reservation. Admins can review all inventory claims.
- Customers can rate only the dealer quote they personally confirmed, once per group. Dealer rating averages are shown with customer quote comparisons; written feedback is anonymized in the dealer workspace.
- Customers may report issues only for their own groups. Dealers may report issues only for groups matching their approved make/city. Admins can update issue status and notes.

MongoDB stores app data in the separate `convoy` database. Set `MONGO_URI` and `MONGO_DB` in the server process environment to use a separately managed instance. Never put database credentials, payment keys, or OTP secrets in source code or chat.

## Free protected demo deployment (Render + MongoDB Atlas)

The `render.yaml` in this project directory deploys Convoy directly; it does not use the unrelated root Dockerfile or Sawarri Compose stack. To deploy:

1. Create a MongoDB Atlas M0 cluster and a dedicated database user for the demo. Create a GitHub repository from this project directory, then connect it to Render and deploy the Blueprint from its `render.yaml`.
2. In Render's service environment settings, set `MONGO_URI` to the Atlas connection string and `CONVOY_ACCESS_PASSWORD` to a unique, strong preview password. Keep both values in the provider's secret settings, never in source control or chat. The access username is `preview` by default and can be changed with `CONVOY_ACCESS_USERNAME`.
3. Configure Atlas network access for the Render service. Render Free does not provide a fixed outbound IP; if an allow-list rule must be opened for this demo, use a dedicated least-privilege demo DB user, unique credentials, and no real customer data. Prefer a host with restricted/static egress for anything sensitive.
4. In Render's service environment, also set `CONVOY_ADMIN_PHONE` and `CONVOY_DEMO_OTP`; keep them out of source control. Open the Render service URL. The browser first prompts for the preview username/password; after that, use the separately configured demo OTP and admin mobile.

Render's free web service can sleep while idle and have a cold start; Atlas M0 also has free-tier limits. Availability, quotas, and provider terms may change. The `/api/health` check is public to Render for service monitoring. This setup is for a password-protected demo only, not public production or real payments.

## Fees and important limitations

- Creating or joining an active group records a **simulated ₹500 entry payment** for that buyer. A waitlist spot is free.
- Leaving an unconfirmed group records a **simulated ₹500 refund**.
- Confirming a dealer quote records a **simulated ₹2,000 purchase fee** for that individual buyer.
- **No real money is charged or refunded.** OTP delivery is simulated too. These flows are not connected to an SMS service or payment gateway.
- Dealer approval and feature permissions are demo flags only; they do not verify a dealer's real-world authorisation. Quote figures, stock, terms, inventory, and vehicle availability are not independently validated.
- This demo uses a server-configured OTP without SMS delivery and is not suitable for public or production access. Before launch, integrate real OTP and licensed payment providers, verify dealer credentials, add provider webhook/refund reconciliation, establish customer consent/terms, secure database access, and perform security and operational reviews.
