"use strict";

const state = {
  role: "CUSTOMER",
  user: null,
  customerProfile: null,
  catalog: [],
  groups: [],
  ownGroups: [],
  dealerGroups: [],
  adminGroups: [],
  adminDeals: [],
  adminPaymentEntries: [],
  adminInventory: [],
  adminRatings: [],
  adminIssues: [],
  adminAudit: [],
};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function append(parent, tag, className, text) {
  const element = node(tag, className, text);
  parent.append(element);
  return element;
}

function setMessage(element, message, isError = false) {
  element.textContent = message || "";
  element.classList.toggle("error", Boolean(isError));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    let message = payload?.detail || payload?.message || `Request failed (${response.status}).`;
    if (Array.isArray(message)) message = message.map((entry) => entry.msg).join(" ");
    throw new Error(message);
  }
  return payload;
}

function post(path, body) {
  return api(path, { method: "POST", body: JSON.stringify(body) });
}

function setBusy(button, busy, text) {
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? text : button.dataset.defaultText;
}

function localDateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function roleName(role) {
  return role === "ADMIN" ? "Admin" : role === "DEALER" ? "Dealer" : "Customer";
}

function showLogin() {
  $("#workspace").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
}

function showRoleView(role) {
  $("#loginScreen").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $$(".role-view").forEach((view) => view.classList.add("hidden"));
  $("#dealerPending").classList.add("hidden");
  $("#groupsNav").classList.toggle("hidden", role !== "CUSTOMER");
  $("#ordersNav").classList.toggle("hidden", role !== "CUSTOMER");
  $("#dealerNav").classList.toggle("hidden", role !== "DEALER");
  $("#adminNav").classList.toggle("hidden", role !== "ADMIN");
  $("#workspaceLabel").textContent = `${roleName(role).toUpperCase()} WORKSPACE`;
  $("#breadcrumbRole").textContent = roleName(role);
  $("#welcomeTitle").textContent = `Welcome, ${state.user.name || state.user.dealerName || roleName(role)}`;
  $("#userAvatar").textContent = (state.user.name || state.user.dealerName || roleName(role)).trim().charAt(0).toUpperCase();
  if (role === "CUSTOMER") {
    $("#customerView").classList.remove("hidden");
    $("#welcomeCopy").textContent = "Find your exact car group, then compare itemized on-road offers.";
    $("#sidebarTipTitle").textContent = "Your choice. Your car.";
    $("#sidebarTipCopy").textContent = "Compare final on-road totals, not headline discounts.";
  } else if (role === "DEALER") {
    $("#welcomeCopy").textContent = "Respond to target-reached local groups with a clear, written quotation.";
    $("#sidebarTipTitle").textContent = "Make every line clear.";
    $("#sidebarTipCopy").textContent = "Show confirmed prices separately from conditional benefits.";
    const status = state.user.verificationStatus;
    if (status !== "VERIFIED") {
      $("#dealerPending").classList.remove("hidden");
      $("#pendingDealerTitle").textContent = status === "REJECTED" ? "Dealer access not approved" : "Approval required";
      $("#pendingDealerCopy").textContent = status === "REJECTED"
        ? "This dealership is not approved for demo leads. Contact the local admin if this is unexpected."
        : "A local admin must review and approve this demo dealership before leads and quotes are available.";
    } else {
      $("#dealerView").classList.remove("hidden");
      $("#dealerPortalName").textContent = state.user.dealerName || "Share an offer";
      const permissions = state.user.permissions || {};
      $("#dealer-groups").classList.toggle("hidden", !permissions.sell);
      $(".dealer-quote-panel").classList.toggle("hidden", !permissions.sell);
      $(".dealer-offers-panel").classList.toggle("hidden", !permissions.sell);
      $("#dealerInventoryPanel").classList.toggle("hidden", !permissions.inventory);
      $("#dealerPaymentsPanel").classList.toggle("hidden", !permissions.payments);
      $("#dealerRatingsPanel").classList.toggle("hidden", !permissions.ratings);
      $("#dealerIssuesPanel").classList.toggle("hidden", !permissions.issues);
      const make = state.catalog.find((entry) => entry.make === state.user.make);
      $("#inventoryModel").replaceChildren(...(make?.models || []).map((model) => {
        const option = node("option", "", model);
        option.value = model;
        return option;
      }));
      $("#inventoryCity").value = state.user.city || "Gurgaon";
    }
  } else {
    $("#adminView").classList.remove("hidden");
    setAdminTab("overview");
    $("#welcomeCopy").textContent = "Review demo dealerships and monitor local buying groups.";
    $("#sidebarTipTitle").textContent = "Review before access.";
    $("#sidebarTipCopy").textContent = "Demo approval does not verify a dealership's real-world authorisation.";
  }
}

async function checkDatabase() {
  const status = $("#databaseStatus");
  try {
    await api("/api/health");
    status.classList.add("connected");
    status.lastElementChild.textContent = " Local MongoDB connected · demo mode";
  } catch (error) {
    status.classList.remove("connected");
    status.lastElementChild.textContent = ` ${error.message}`;
  }
}

function updateRoleFields() {
  const role = state.role;
  $("#nameField").classList.toggle("hidden", role !== "CUSTOMER");
  $("#dealerField").classList.toggle("hidden", role !== "DEALER");
  $("#dealerCityField").classList.toggle("hidden", role !== "DEALER");
  $("#dealerMakeField").classList.toggle("hidden", role !== "DEALER");
  $("#nameInput").required = false;
  $("#dealerInput").required = role === "DEALER";
  $("#dealerCityInput").required = role === "DEALER";
  $("#dealerMakeInput").required = role === "DEALER";
  $("#phoneInput").readOnly = false;
}

function populateCatalog() {
  const makes = state.catalog.map((entry) => entry.make);
  const makeOptions = makes.map((make) => {
    const option = node("option", "", make);
    option.value = make;
    return option;
  });
  $("#orderMake").replaceChildren(...makeOptions.map((option) => option.cloneNode(true)));
  $("#dealerMakeInput").replaceChildren(...makeOptions.map((option) => option.cloneNode(true)));
  $("#adminDealerMake").replaceChildren(...makeOptions);
  $("#inventoryModel").replaceChildren(...(state.catalog.find((entry) => entry.make === state.user?.make)?.models || []).map((model) => {
    const option = node("option", "", model);
    option.value = model;
    return option;
  }));
  refreshModels();
}

function refreshModels() {
  const make = $("#orderMake").value;
  const models = state.catalog.find((entry) => entry.make === make)?.models || [];
  $("#orderModel").replaceChildren(...models.map((model) => {
    const option = node("option", "", model);
    option.value = model;
    return option;
  }));
}

function updateSelectedVehicle() {
  return {
    variant: $("#orderVariant").value.trim(),
    fuel: $("#orderFuel").value,
    transmission: $("#orderTransmission").value,
  };
}

function groupHeading(group) {
  return `${group.modelYear} ${group.make} ${group.model} ${group.variant}`;
}

function groupSpecs(group) {
  return `${group.fuelType} · ${group.transmission} · ${group.city} · ${group.purchaseWindow.replaceAll("_", " ").toLowerCase()}`;
}

function addGroupStatus(parent, group) {
  const badge = append(parent, "span", "status-tag", group.status.replaceAll("_", " ").toLowerCase());
  if (group.status === "CANCELLED" || group.status === "EXPIRED") badge.classList.add("cancelled");
  if (group.status === "TARGET_REACHED" || group.status === "QUOTING") badge.classList.add("confirmed");
}

function makeGroupCard(group, options = {}) {
  const card = node("article", "group-card");
  append(card, "span", "group-car-icon", "◇");
  const info = append(card, "div", "group-info");
  append(info, "b", "", groupHeading(group));
  append(info, "small", "", groupSpecs(group));
  const progress = append(info, "div", "group-demand");
  const percent = Math.min(100, Math.round((group.memberCount / group.targetMemberCount) * 100));
  progress.textContent = `${group.memberCount} of ${group.targetMemberCount} buyers · ${percent}%`;
  const bar = append(info, "progress", "progress-track");
  bar.max = 100;
  bar.value = percent;

  const action = append(card, "div", options.compact ? "group-offer" : "group-action");
  addGroupStatus(action, group);
  if (options.dealer) {
    const best = group.quotes?.[0];
    append(action, "span", "", best ? `Best quote ${rupees.format(best.onRoadTotal)}` : "Invite a written offer");
    const quoteButton = append(action, "button", "small-action-button", "Prepare quote →");
    quoteButton.type = "button";
    quoteButton.addEventListener("click", () => {
      $("#dealerGroupSelect").value = group.id;
      $("#dealerGroupSelect").dispatchEvent(new Event("change"));
      $("#dealerQuoteForm").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } else if (options.compact) {
    const best = group.quotes?.[0];
    if (best) {
      append(action, "small", "", "BEST SUBMITTED OFFER");
      append(action, "b", "", rupees.format(best.onRoadTotal));
    } else {
      append(action, "span", "", group.myMembership?.status === "WAITLISTED" ? "No fee until a space opens" : "Waiting for target");
    }
  } else {
    const membership = group.myMembership;
    if (membership?.status === "ACTIVE") {
      append(action, "span", "membership-pill", "In your groups");
    } else if (membership?.status === "WAITLISTED") {
      append(action, "span", "membership-pill waitlist-pill", "Waitlisted · no fee");
    } else if (group.status === "OPEN" || group.status === "TARGET_REACHED") {
      const full = group.memberCount >= group.targetMemberCount;
      const button = append(action, "button", full ? "small-action-button waitlist-button" : "small-action-button", full ? "Join waitlist" : "Join · ₹500");
      button.type = "button";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await post(`/api/groups/${encodeURIComponent(group.id)}/join`, {});
          await loadCustomerData();
        } catch (error) {
          window.alert(error.message);
          button.disabled = false;
        }
      });
    } else {
      append(action, "span", "membership-pill", "Not accepting members");
    }
  }
  return card;
}

function renderGroups() {
  const filter = $("#groupCityFilter").value;
  const filtered = state.groups.filter((group) => !filter || group.city === filter);
  const container = $("#customerGroups");
  container.replaceChildren(...filtered.map((group) => makeGroupCard(group)));
  $("#customerGroupsEmpty").classList.toggle("hidden", filtered.length > 0);
  $("#customerGroupCount").textContent = String(filtered.length);
  const active = state.ownGroups.filter((group) => group.myMembership?.status === "ACTIVE").length;
  $("#customerActiveCount").textContent = String(active);
}

function paymentStatusText(payment) {
  if (!payment) return "";
  if (payment.status === "SIMULATED_REFUNDED") return "Entry fee · ₹500 simulated refund";
  if (payment.status === "SIMULATED_PAID" && payment.amount === 2000) return "Purchase confirmation · ₹2,000 simulated";
  if (payment.status === "SIMULATED_PAID") return "Entry fee · ₹500 simulated";
  return `${payment.status.replaceAll("_", " ").toLowerCase()} · ${rupees.format(Math.abs(payment.amount || 0))}`;
}

function quoteRows(quote) {
  const rows = [
    ["Ex-showroom", quote.exShowroom],
    ...(quote.gstIncludedAmount ? [["GST included in ex-showroom · information only", quote.gstIncludedAmount, true]] : []),
    ["Dealer discount", -quote.dealerDiscount],
    ["Manufacturer benefit", -quote.manufacturerBenefit],
    [`Group benefit (${quote.groupBenefitDescription || "group allocation"})`, -quote.groupBenefitPerVehicle],
    ["Insurance", quote.insuranceAmount],
    ["RTO / registration fees", quote.registrationAmount],
    ["Road / state tax", quote.roadTaxAmount],
    ["TCS", quote.tcsAmount],
    ["FASTag", quote.fastagAmount],
    ["Hypothecation fee", quote.hypothecationAmount],
    ...(quote.otherTaxesAmount ? [[`Other taxes · ${quote.otherTaxesExplanation}`, quote.otherTaxesAmount]] : []),
    ["Accessories", quote.accessoriesAmount],
    ["Handling", quote.handlingAmount],
    ["Logistics", quote.logisticsAmount],
    ...(quote.otherCharges ? [[`Other · ${quote.otherChargesExplanation}`, quote.otherCharges]] : []),
  ];
  return rows;
}

function renderQuoteDetails(container, quote, group, membership) {
  const quoteBox = append(container, "div", "order-quotes");
  const header = append(quoteBox, "div", "quote-section-heading");
  append(header, "h4", "", "Itemized dealer offers");
  append(header, "span", "quote-reference", `${quote.quoteReference} · revision ${quote.revision}`);
  const dealerDetails = append(quoteBox, "div", "quote-dealer-details");
  append(dealerDetails, "b", "", `${quote.dealerName} · ${quote.vehicleVariant || group.variant} · ${quote.vehicleColour || "Colour not specified"}`);
  if (quote.ratingSummary?.count) {
    append(dealerDetails, "span", "rating-display", `Buyer rating ${quote.ratingSummary.average}/5 · ${quote.ratingSummary.count} confirmed purchase rating(s)`);
  }
  append(dealerDetails, "span", "", `Outlet: ${quote.dealerLocation || "Not provided"}`);
  append(dealerDetails, "span", "", `Salesperson: ${quote.salespersonName || "Not provided"} · Manager: ${quote.managerName || "Not provided"}`);
  append(dealerDetails, "span", "", `Authorisation reference: ${quote.authorizationReference || "Not provided"} · Demo approval: ${quote.dealerDemoApprovalStatus || "unknown"}`);
  append(dealerDetails, "small", "", "Dealer details and authorisation reference are self-reported; demo approval is not legal verification.");
  const grid = append(quoteBox, "div", "quote-list");
  for (const [label, amount, informational] of quoteRows(quote)) {
    const row = append(grid, "div", "quote-line");
    append(row, "span", "", label);
    const text = informational ? `${rupees.format(amount)} included` : `${amount < 0 ? "−" : ""}${rupees.format(Math.abs(amount))}`;
    append(row, "b", `${amount < 0 ? "discount-amount" : ""}${informational ? " informational-amount" : ""}`.trim(), text);
  }
  const total = append(grid, "div", "quote-line quote-total");
  append(total, "span", "", `On-road total · per car · ${quote.insuranceType === "BUYER_ARRANGED" ? "buyer-arranged insurance" : quote.insuranceProvider || "dealer insurance"}`);
  append(total, "b", "", rupees.format(quote.onRoadTotal));
  append(quoteBox, "p", "quote-delivery", `${quote.deliveryEstimate} · Stock: ${quote.stockStatus.toLowerCase()} · Valid until ${new Date(quote.validUntil).toLocaleDateString("en-IN")}`);
  if (quote.terms) append(quoteBox, "p", "quote-terms", quote.terms);
  const conditional = quote.conditionalBenefits.filter((benefit) => benefit.amount > 0);
  if (conditional.length) {
    const conditionalBox = append(quoteBox, "div", "conditional-summary");
    append(conditionalBox, "b", "", "Conditional benefits · not included in on-road total");
    for (const benefit of conditional) {
      append(conditionalBox, "span", "", `${benefit.name}: ${rupees.format(benefit.amount)} · ${benefit.condition}`);
    }
  }
  if (membership?.status === "ACTIVE" && membership.purchaseStatus !== "PURCHASE_CONFIRMED") {
    const selectButton = append(quoteBox, "button", "confirm-purchase-button", `Confirm this purchase · ₹2,000 demo fee`);
    selectButton.type = "button";
    selectButton.addEventListener("click", async () => {
      if (!window.confirm(`Confirm your purchase from ${quote.dealerName} at ${rupees.format(quote.onRoadTotal)} on-road? This records a simulated ₹2,000 fee; no money is collected.`)) return;
      selectButton.disabled = true;
      try {
        await post(`/api/groups/${encodeURIComponent(group.id)}/selection`, { quote_id: quote.id });
        await loadCustomerData();
      } catch (error) {
        window.alert(error.message);
        selectButton.disabled = false;
      }
    });
  }
}

function renderPurchaseRating(container, group, membership) {
  const quote = membership.selectedQuote;
  if (!quote || membership.purchaseStatus !== "PURCHASE_CONFIRMED") return;
  const panel = append(container, "div", "purchase-rating");
  append(panel, "b", "", `Rate your confirmed purchase · ${quote.dealerName}`);
  if (membership.rating) {
    append(panel, "p", "rating-display", `${"★".repeat(membership.rating.rating)}${"☆".repeat(5 - membership.rating.rating)} · ${membership.rating.rating}/5`);
    if (membership.rating.comment) append(panel, "p", "", membership.rating.comment);
    return;
  }
  const form = append(panel, "form", "form-stack");
  const ratingLabel = append(form, "label", "", "Your rating");
  const rating = append(ratingLabel, "select");
  rating.required = true;
  rating.id = `rating-${group.id}`;
  for (let score = 5; score >= 1; score -= 1) {
    const option = node("option", "", `${score} / 5`);
    option.value = String(score);
    rating.append(option);
  }
  const commentLabel = append(form, "label", "", "Comment (optional)");
  const comment = append(commentLabel, "textarea");
  comment.rows = 2;
  comment.maxLength = 800;
  const message = append(form, "p", "form-message");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true, "Saving rating…");
    try {
      await post(`/api/groups/${encodeURIComponent(group.id)}/ratings`, {
        quote_id: quote.id,
        rating: Number(rating.value),
        comment: comment.value.trim(),
      });
      await loadCustomerData();
    } catch (error) {
      setMessage(message, error.message, true);
    } finally {
      setBusy(button, false);
    }
  });
  const submit = append(form, "button", "small-action-button", "Submit rating");
  submit.type = "submit";
}

function renderOwnGroups() {
  const container = $("#customerOrders");
  const groups = state.ownGroups;
  container.replaceChildren();
  $("#customerOrdersEmpty").classList.toggle("hidden", groups.length > 0);
  $("#orderCount").textContent = `${groups.length} ${groups.length === 1 ? "group" : "groups"}`;
  for (const group of groups) {
    const card = append(container, "article", "order-card");
    const top = append(card, "div", "order-top");
    const heading = append(top, "div", "");
    append(heading, "p", "eyebrow", group.city.toUpperCase());
    append(heading, "h3", "", groupHeading(group));
    append(heading, "small", "order-specs", groupSpecs(group));
    addGroupStatus(top, group);
    append(card, "p", "order-progress", `${group.memberCount} / ${group.targetMemberCount} buyers · closes ${new Date(`${group.purchaseEndDate}T00:00:00`).toLocaleDateString("en-IN")}`);
    const activity = group.activity || [];
    if (activity.length) {
      const timeline = append(card, "details", "activity-timeline");
      append(timeline, "summary", "", `Recent group activity · ${activity.length} updates`);
      const entries = append(timeline, "ol");
      for (const entry of [...activity].reverse()) {
        const row = append(entries, "li");
        append(row, "span", "", activityLabel(entry.type));
        if (entry.createdAt) {
          const time = append(row, "time", "", new Date(entry.createdAt).toLocaleString("en-IN"));
          time.dateTime = entry.createdAt;
        }
      }
    }
    const membership = group.myMembership;
    const payments = append(card, "div", "payment-list");
    if (membership?.entryPayment) {
      append(payments, "span", `payment-chip${membership.entryPayment.status === "SIMULATED_REFUNDED" ? " refunded" : ""}`, paymentStatusText(membership.entryPayment));
    }
    if (membership?.successPayment) append(payments, "span", "payment-chip confirmed-chip", paymentStatusText(membership.successPayment));
    if (membership?.status === "WAITLISTED") append(card, "p", "awaiting-note", "You are on the waitlist. No entry fee is recorded until a place opens.");
    if (membership?.purchaseStatus === "PURCHASE_CONFIRMED") append(card, "p", "confirmed-note", "You confirmed a purchase. The ₹2,000 fee is simulated only.");
    const selectable = group.quotes.filter((quote) => quote.validUntil && new Date(quote.validUntil) > new Date());
    if (selectable.length) {
      for (const quote of selectable) renderQuoteDetails(card, quote, group, membership);
    } else if (membership?.status === "ACTIVE") {
      append(card, "p", "awaiting-note", "No current itemized dealer offers. Quotes will appear here after the group reaches its target.");
    }
    if (membership?.purchaseStatus === "PURCHASE_CONFIRMED") renderPurchaseRating(card, group, membership);
    if (membership?.status === "ACTIVE" && membership.purchaseStatus !== "PURCHASE_CONFIRMED") {
      const leaveButton = append(card, "button", "cancel-order-button", "Leave group · simulate ₹500 refund");
      leaveButton.type = "button";
      leaveButton.addEventListener("click", async () => {
        if (!window.confirm("Leave this group? A simulated ₹500 entry-fee refund will be recorded; no real payment is made.")) return;
        leaveButton.disabled = true;
        try {
          await post(`/api/groups/${encodeURIComponent(group.id)}/leave`, {});
          await loadCustomerData();
        } catch (error) {
          window.alert(error.message);
          leaveButton.disabled = false;
        }
      });
    }
  }
}

function activityLabel(type) {
  const labels = {
    GROUP_CREATED: "Buying group opened",
    MEMBER_JOINED: "A buyer joined the group",
    TARGET_REACHED: "Buyer target reached",
    QUOTE_SUBMITTED: "A dealer submitted a quote",
    BUYER_SELECTED_QUOTE: "A buyer confirmed a quote",
    MEMBER_LEFT_REFUND_SIMULATED: "A buyer left the group",
    GROUP_EXPIRED: "Group request expired",
  };
  return labels[type] || "Buying group updated";
}

function updateIssueGroupOptions(select, groups) {
  const previous = select.value;
  select.replaceChildren(new Option("No specific group", ""));
  for (const group of groups) {
    const option = new Option(`${group.city} · ${groupHeading(group)}`, group.id);
    select.append(option);
  }
  if (groups.some((group) => group.id === previous)) select.value = previous;
}

function renderIssueList(container, issues) {
  container.replaceChildren(...issues.map((issue) => {
    const card = node("article", "issue-card");
    const top = append(card, "div", "issue-card-heading");
    append(top, "b", "", `${issue.category.replaceAll("_", " ")} · ${issue.status.replaceAll("_", " ").toLowerCase()}`);
    append(top, "small", "", new Date(issue.createdAt).toLocaleString("en-IN"));
    append(card, "p", "", issue.description);
    if (issue.reporterName) append(card, "small", "", `${issue.reporterRole}: ${issue.reporterName} ${issue.reporterPhoneMasked ? `(${issue.reporterPhoneMasked})` : ""}`);
    if (issue.groupId) append(card, "small", "", `Group: ${issue.groupId.slice(0, 8)}`);
    if (issue.adminNote) append(card, "p", "issue-admin-note", `Admin note: ${issue.adminNote}`);
    return card;
  }));
}

function renderCustomerProfile(profile) {
  const form = $("#customerProfileForm");
  if (!form.dataset.edited) {
    $("#profileFullName").value = profile.name || "";
  }
  if (!$("#customerFirstName").value && profile.name) {
    $("#customerFirstName").value = profile.name.trim().split(/\s+/)[0];
  }
  $("#profileCompletionLabel").textContent = `${profile.completionPercent}% complete`;
  $(".profile-progress").setAttribute("aria-valuenow", String(profile.completionPercent));
  $("#profileProgressBar").style.width = `${profile.completionPercent}%`;
  $("#aadhaarProfileHint").textContent = profile.aadhaarAdded
    ? `On file: ${profile.aadhaarMasked}. Leave blank to keep it.`
    : "Aadhaar is not on file.";
  $("#panProfileHint").textContent = profile.panAdded
    ? `On file: ${profile.panMasked}. Leave blank to keep it.`
    : "PAN is not on file.";
  $("#profileAadhaar").required = !profile.aadhaarAdded;
  $("#profilePan").required = !profile.panAdded;
  $("#profileAadhaar").placeholder = profile.aadhaarAdded ? "Saved — enter to replace" : "12 digits";
  $("#profilePan").placeholder = profile.panAdded ? "Saved — enter to replace" : "e.g. ABCDE1234F";
  state.customerProfile = profile;
}

async function handleCustomerProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = $("#customerProfileMessage");
  message.textContent = "";
  message.classList.remove("error");
  setBusy(button, true, "Saving profile…");
  try {
    const profile = await api("/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: $("#profileFullName").value.trim(),
        aadhaar: $("#profileAadhaar").value.trim(),
        pan: $("#profilePan").value.trim().toUpperCase(),
      }),
    });
    $("#profileAadhaar").value = "";
    $("#profilePan").value = "";
    form.dataset.edited = "";
    renderCustomerProfile(profile);
    state.user.name = profile.name;
    $("#welcomeTitle").textContent = `Welcome, ${profile.name}`;
    $("#userAvatar").textContent = profile.name.trim().charAt(0).toUpperCase();
    message.textContent = profile.complete
      ? "Your profile is complete. These details are not identity-verified."
      : "Profile saved. Add the remaining details to complete it.";
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  } finally {
    setBusy(button, false);
  }
}

async function handleIssueForm(event, prefix) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = $(`#${prefix}IssueMessage`);
  setMessage(message, "");
  setBusy(button, true, "Sending issue…");
  try {
    await post("/api/issues", {
      category: $(`#${prefix}IssueCategory`).value,
      group_id: $(`#${prefix}IssueGroup`).value,
      description: $(`#${prefix}IssueDescription`).value.trim(),
    });
    form.reset();
    await (prefix === "customer" ? loadCustomerData() : loadDealerIssues());
    setMessage(message, "Issue sent to the local admin for review.");
  } catch (error) {
    setMessage(message, error.message, true);
  } finally {
    setBusy(button, false);
  }
}

async function loadCustomerData() {
  const city = $("#groupCityFilter").value;
  const query = city ? `?city=${encodeURIComponent(city)}` : "";
  const [groups, ownGroups, issues, profile] = await Promise.all([
    api(`/api/groups${query}`),
    api("/api/orders"),
    api("/api/issues"),
    api("/api/auth/profile"),
  ]);
  state.groups = groups;
  state.ownGroups = ownGroups;
  renderCustomerProfile(profile);
  updateIssueGroupOptions($("#customerIssueGroup"), ownGroups);
  renderIssueList($("#customerIssues"), issues);
  $("#customerIssuesEmpty").classList.toggle("hidden", issues.length > 0);
  renderGroups();
  renderOwnGroups();
}

function groupCreatePayload() {
  const selected = updateSelectedVehicle();
  return {
    first_name: $("#customerFirstName").value.trim(),
    make: $("#orderMake").value,
    model: $("#orderModel").value,
    model_year: Number($("#orderYear").value),
    variant: selected.variant,
    fuel_type: selected.fuel,
    transmission: selected.transmission,
    city: $("#orderCity").value,
    target_member_count: Number($("#targetCount").value),
    minimum_member_count: 3,
    purchase_window: $("#purchaseWindow").value,
    purchase_end_date: $("#purchaseEndDate").value,
    visibility: "PUBLIC",
  };
}

async function handleCreateGroup(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setMessage($("#orderMessage"), "");
  setBusy(button, true, "Creating group…");
  try {
    const group = await post("/api/groups", groupCreatePayload());
    setMessage($("#orderMessage"), `Group created. A simulated ₹500 entry payment is recorded. Group ${group.id.slice(0, 8)} is now open.`);
    await loadCustomerData();
    $("#my-groups").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setMessage($("#orderMessage"), error.message, true);
  } finally {
    setBusy(button, false);
  }
}

function eligibleQuoteFields() {
  const number = (id) => Number($(`#${id}`).value || 0);
  return {
    vehicle_colour: $("#vehicleColour").value.trim(),
    dealer_location: $("#dealerLocation").value.trim(),
    salesperson_name: $("#salespersonName").value.trim(),
    manager_name: $("#managerName").value.trim(),
    authorization_reference: $("#authorizationReference").value.trim(),
    ex_showroom: number("dealerExShowroom"),
    gst_included_amount: number("gstIncludedAmount"),
    dealer_discount: number("dealerDiscount"),
    manufacturer_benefit: number("manufacturerBenefit"),
    group_benefit_total: number("groupBenefitTotal"),
    group_benefit_description: $("#groupBenefitDescription").value.trim(),
    insurance_amount: number("insuranceAmount"),
    insurance_type: $("#insuranceType").value,
    insurance_provider: $("#insuranceProvider").value.trim(),
    registration_amount: number("registrationAmount"),
    road_tax_amount: number("roadTaxAmount"),
    other_taxes_amount: number("otherTaxesAmount"),
    other_taxes_explanation: $("#otherTaxesExplanation").value.trim(),
    tcs_amount: number("tcsAmount"),
    fastag_amount: number("fastagAmount"),
    hypothecation_amount: number("hypothecationAmount"),
    accessories_amount: number("accessoriesAmount"),
    handling_amount: number("handlingAmount"),
    logistics_amount: number("logisticsAmount"),
    other_charges: number("otherCharges"),
    other_charges_explanation: $("#otherChargesExplanation").value.trim(),
    exchange_bonus: number("exchangeBonus"),
    exchange_condition: $("#exchangeCondition").value.trim(),
    corporate_benefit: number("corporateBenefit"),
    corporate_condition: $("#corporateCondition").value.trim(),
    stock_status: $("#stockStatus").value,
    quote_valid_until: $("#quoteValidUntil").value,
    delivery_estimate: $("#deliveryEstimate").value.trim(),
    terms: $("#quoteTerms").value.trim(),
  };
}

function updateQuoteFormRequirements() {
  const insuranceByDealer = $("#insuranceType").value === "DEALER";
  $("#insuranceProviderField").classList.toggle("hidden", !insuranceByDealer);
  $("#insuranceProvider").required = insuranceByDealer;
  const hasOtherCharges = Number($("#otherCharges").value || 0) > 0;
  $("#otherChargesExplanationField").classList.toggle("hidden", !hasOtherCharges);
  $("#otherChargesExplanation").required = hasOtherCharges;
  const hasOtherTaxes = Number($("#otherTaxesAmount").value || 0) > 0;
  $("#otherTaxesExplanationField").classList.toggle("hidden", !hasOtherTaxes);
  $("#otherTaxesExplanation").required = hasOtherTaxes;
  $("#groupBenefitDescription").required = Number($("#groupBenefitTotal").value || 0) > 0;
  $("#exchangeCondition").required = Number($("#exchangeBonus").value || 0) > 0;
  $("#corporateCondition").required = Number($("#corporateBenefit").value || 0) > 0;
  updateQuotePreview();
}

function updateQuotePreview() {
  const fields = eligibleQuoteFields();
  const group = state.dealerGroups.find((entry) => entry.id === $("#dealerGroupSelect").value);
  const quantity = group?.memberCount || 1;
  const groupPerCar = Math.floor((fields.group_benefit_total + Math.floor(quantity / 2)) / quantity);
  const total = fields.ex_showroom - fields.dealer_discount - fields.manufacturer_benefit - groupPerCar
    + fields.insurance_amount + fields.registration_amount + fields.road_tax_amount
    + fields.other_taxes_amount + fields.tcs_amount + fields.fastag_amount + fields.hypothecation_amount
    + fields.accessories_amount + fields.handling_amount + fields.logistics_amount + fields.other_charges;
  $("#dealerTotalPreview").textContent = total > 0 ? rupees.format(total) : "₹—";
}

function updateDealerSelectedVehicle() {
  const group = state.dealerGroups.find((entry) => entry.id === $("#dealerGroupSelect").value);
  $("#dealerVehicleVariant").textContent = group
    ? `${groupHeading(group)} · ${group.fuelType} · ${group.transmission} · ${group.city}`
    : "Select a buying group to see its requested variant";
  updateQuotePreview();
}

function updateDealerGroupOptions() {
  const select = $("#dealerGroupSelect");
  const previous = select.value;
  select.replaceChildren();
  for (const group of state.dealerGroups) {
    const option = node("option", "", `${group.city} · ${groupHeading(group)} · ${group.memberCount} buyers`);
    option.value = group.id;
    select.append(option);
  }
  if (state.dealerGroups.some((group) => group.id === previous)) select.value = previous;
  const hasGroups = state.dealerGroups.length > 0;
  select.disabled = !hasGroups;
  $("#dealerQuoteForm").querySelector('button[type="submit"]').disabled = !hasGroups;
  updateDealerSelectedVehicle();
}

function renderDealerGroups() {
  const search = $("#dealerLeadSearch").value.trim().toLocaleLowerCase();
  const quoteFilter = $("#dealerLeadQuoteFilter").value;
  const filtered = state.dealerGroups.filter((group) => {
    const text = `${groupHeading(group)} ${group.city} ${group.fuelType} ${group.transmission}`.toLocaleLowerCase();
    const matchesSearch = !search || text.includes(search);
    const hasQuotes = Boolean(group.quotes?.length);
    const matchesQuotes = quoteFilter === "ALL"
      || (quoteFilter === "HAS_QUOTES" && hasQuotes)
      || (quoteFilter === "NO_QUOTES" && !hasQuotes);
    return matchesSearch && matchesQuotes;
  });
  const container = $("#dealerGroups");
  container.replaceChildren(...filtered.map((group) => makeGroupCard(group, { dealer: true })));
  $("#dealerGroupsEmpty").textContent = filtered.length
    ? ""
    : state.dealerGroups.length
      ? "No leads match these filters."
      : "No eligible target-reached group leads in your city yet.";
  $("#dealerGroupsEmpty").classList.toggle("hidden", filtered.length > 0);
  $("#dealerGroupCount").textContent = String(state.dealerGroups.length);
  $("#dealerBuyerCount").textContent = String(state.dealerGroups.reduce((count, group) => count + group.memberCount, 0));
  updateDealerGroupOptions();
}

function renderDealerQuotes(quotes) {
  const container = $("#dealerQuotes");
  container.replaceChildren(...quotes.map((quote) => {
    const row = node("article", "dealer-offer-row");
    const info = append(row, "div", "");
    append(info, "b", "", `${quote.dealerName} · ${quote.quoteReference}`);
    append(info, "small", "", `Revision ${quote.revision} · ${quote.stockStatus.toLowerCase()} stock · valid until ${new Date(quote.validUntil).toLocaleDateString("en-IN")}`);
    append(row, "strong", "", rupees.format(quote.onRoadTotal));
    append(row, "span", "", `${quote.quantity} cars · ${rupees.format(quote.groupOnRoadTotal)} group total`);
    return row;
  }));
  $("#dealerQuotesEmpty").classList.toggle("hidden", quotes.length > 0);
  $("#dealerQuoteCount").textContent = String(quotes.length);
}

function renderInventory(container, items, includeDealer = false) {
  container.replaceChildren(...items.map((item) => {
    const row = node("article", "inventory-row");
    const info = append(row, "div", "");
    append(info, "b", "", `${item.modelYear} ${item.model} ${item.variant} · ${item.colour}`);
    append(info, "small", "", `${item.fuelType} · ${item.transmission} · ${item.city} · ${item.stockStatus.replaceAll("_", " ").toLowerCase()} · quantity ${item.quantity}${item.expectedDelivery ? ` · expected ${item.expectedDelivery}` : ""}`);
    if (includeDealer) append(info, "small", "", `${item.dealerName || "Dealer"} · ${item.make || ""} · ${item.dealerPhoneMasked || ""}`);
    if (!includeDealer) {
      const edit = append(row, "button", "small-action-button", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => {
        $("#inventoryId").value = item.id;
        $("#inventoryModel").value = item.model;
        $("#inventoryYear").value = item.modelYear;
        $("#inventoryVariant").value = item.variant;
        $("#inventoryColour").value = item.colour;
        $("#inventoryFuel").value = item.fuelType;
        $("#inventoryTransmission").value = item.transmission;
        $("#inventoryCity").value = item.city;
        $("#inventoryQuantity").value = item.quantity;
        $("#inventoryStatus").value = item.stockStatus;
        $("#inventoryDelivery").value = item.expectedDelivery || "";
        $("#inventorySubmitButton").textContent = "Save inventory changes →";
        $("#dealerInventoryForm").scrollIntoView({ behavior: "smooth", block: "center" });
      });
      const remove = append(row, "button", "reject-button", "Remove");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Remove ${item.model} ${item.variant} from your demo inventory?`)) return;
        try {
          await api(`/api/dealer/inventory/${encodeURIComponent(item.id)}`, { method: "DELETE" });
          await loadDealerData();
        } catch (error) {
          setMessage($("#dealerInventoryMessage"), error.message, true);
        }
      });
    }
    return row;
  }));
}

function renderDealerPayments(groups) {
  const container = $("#dealerPayments");
  container.replaceChildren(...groups.map((group) => {
    const row = node("article", "inventory-row");
    const info = append(row, "div", "");
    append(info, "b", "", group.vehicle);
    append(info, "small", "", `${group.city} · ${group.buyerCount} active buyers`);
    append(row, "span", "", `Entry fees: ${group.entryFeePaidCount}/${group.buyerCount}`);
    append(row, "span", "", `Purchase fees: ${group.purchaseFeePaidCount}/${group.buyerCount}`);
    return row;
  }));
  $("#dealerPaymentsEmpty").classList.toggle("hidden", groups.length > 0);
}

function renderRatings(container, ratings) {
  container.replaceChildren(...ratings.map((rating) => {
    const card = node("article", "issue-card");
    const top = append(card, "div", "issue-card-heading");
    append(top, "b", "", `${rating.dealerName ? `${rating.dealerName} · ` : ""}${rating.vehicle || ""}`);
    append(top, "span", "rating-display", `${"★".repeat(rating.rating)}${"☆".repeat(5 - rating.rating)} · ${rating.rating}/5`);
    append(card, "small", "", new Date(rating.createdAt).toLocaleString("en-IN"));
    if (rating.comment) append(card, "p", "", rating.comment);
    return card;
  }));
}

async function loadDealerIssues() {
  const issues = await api("/api/issues");
  renderIssueList($("#dealerIssues"), issues);
  $("#dealerIssuesEmpty").classList.toggle("hidden", issues.length > 0);
}

async function loadDealerData() {
  if (state.user.verificationStatus !== "VERIFIED") return;
  const permissions = state.user.permissions || {};
  const [groups, quotes, inventory, payments, ratings, issues] = await Promise.all([
    permissions.sell ? api("/api/groups") : Promise.resolve([]),
    permissions.sell ? api("/api/dealer/quotes") : Promise.resolve([]),
    permissions.inventory ? api("/api/dealer/inventory") : Promise.resolve([]),
    permissions.payments ? api("/api/dealer/payments") : Promise.resolve([]),
    permissions.ratings ? api("/api/dealer/ratings") : Promise.resolve({ average: null, count: 0, ratings: [] }),
    permissions.issues ? api("/api/issues") : Promise.resolve([]),
  ]);
  state.dealerGroups = groups;
  renderDealerGroups();
  renderDealerQuotes(quotes);
  renderInventory($("#dealerInventory"), inventory);
  $("#dealerInventoryEmpty").classList.toggle("hidden", inventory.length > 0);
  renderDealerPayments(payments);
  renderRatings($("#dealerRatings"), ratings.ratings);
  $("#dealerRatingSummary").textContent = ratings.count
    ? `${ratings.average}/5 · ${ratings.count} rating(s)`
    : "No ratings";
  $("#dealerRatingsEmpty").classList.toggle("hidden", ratings.count > 0);
  updateIssueGroupOptions($("#dealerIssueGroup"), groups);
  renderIssueList($("#dealerIssues"), issues);
  $("#dealerIssuesEmpty").classList.toggle("hidden", issues.length > 0);
}

async function handleInventoryForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const inventoryId = $("#inventoryId").value;
  const isUpdate = Boolean(inventoryId);
  setMessage($("#dealerInventoryMessage"), "");
  setBusy(button, true, inventoryId ? "Saving inventory…" : "Adding inventory…");
  try {
    const payload = {
      model: $("#inventoryModel").value,
      model_year: Number($("#inventoryYear").value),
      variant: $("#inventoryVariant").value.trim(),
      fuel_type: $("#inventoryFuel").value,
      transmission: $("#inventoryTransmission").value,
      colour: $("#inventoryColour").value.trim(),
      city: $("#inventoryCity").value,
      quantity: Number($("#inventoryQuantity").value),
      stock_status: $("#inventoryStatus").value,
      expected_delivery: $("#inventoryDelivery").value.trim(),
    };
    if (inventoryId) {
      await api(`/api/dealer/inventory/${encodeURIComponent(inventoryId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await post("/api/dealer/inventory", payload);
    }
    form.reset();
    $("#inventoryId").value = "";
    $("#inventorySubmitButton").textContent = "Add inventory item →";
    $("#inventoryCity").value = state.user.city || "Gurgaon";
    await loadDealerData();
    setMessage($("#dealerInventoryMessage"), isUpdate ? "Demo inventory item updated." : "Demo inventory item added.");
  } catch (error) {
    setMessage($("#dealerInventoryMessage"), error.message, true);
  } finally {
    setBusy(button, false);
    $("#inventorySubmitButton").textContent = $("#inventoryId").value
      ? "Save inventory changes →"
      : "Add inventory item →";
  }
}

async function handleDealerQuote(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setMessage($("#dealerQuoteMessage"), "");
  if (!$("#dealerGroupSelect").value) {
    setMessage($("#dealerQuoteMessage"), "Choose a target-reached group first.", true);
    return;
  }
  setBusy(button, true, "Submitting quote…");
  try {
    const quote = await post(`/api/groups/${encodeURIComponent($("#dealerGroupSelect").value)}/quotes`, eligibleQuoteFields());
    setMessage($("#dealerQuoteMessage"), `Quote ${quote.quoteReference}, revision ${quote.revision}, submitted. On-road total: ${rupees.format(quote.onRoadTotal)} per car.`);
    await loadDealerData();
  } catch (error) {
    setMessage($("#dealerQuoteMessage"), error.message, true);
  } finally {
    setBusy(button, false);
  }
}

function makeAdminDealerCard(dealer) {
    const card = node("article", "admin-dealer-card");
    const info = append(card, "div", "admin-dealer-info");
    append(info, "b", "", dealer.dealerName || "Unnamed dealership");
    append(info, "small", "", `${dealer.make} · ${dealer.city} · mobile ending ${dealer.phone.slice(-4)}`);
    append(info, "span", `status-tag ${dealer.verificationStatus === "VERIFIED" ? "confirmed" : ""}`, dealer.verificationStatus.toLowerCase());
    const actions = append(card, "div", "admin-dealer-actions");
    if (dealer.verificationStatus !== "VERIFIED") {
      const approve = append(actions, "button", "approve-button", "Approve demo");
      approve.type = "button";
      approve.addEventListener("click", () => handleVerification(dealer.id, "VERIFIED"));
    }
    if (dealer.verificationStatus !== "REJECTED") {
      const reject = append(actions, "button", "reject-button", "Reject");
      reject.type = "button";
      reject.addEventListener("click", () => handleVerification(dealer.id, "REJECTED"));
    }
    const permissionBox = append(card, "div", "permission-box");
    append(permissionBox, "b", "", "Feature permissions");
    const permissionInputs = {};
    for (const [key, label] of [
      ["sell", "Sell / view matching leads"],
      ["payments", "Payment aggregates"],
      ["ratings", "Dealer ratings"],
      ["issues", "Report / view own issues"],
      ["inventory", "Manage inventory"],
    ]) {
      const labelNode = append(permissionBox, "label", "permission-choice", label);
      const checkbox = append(labelNode, "input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(dealer.permissions?.[key]);
      checkbox.disabled = dealer.verificationStatus !== "VERIFIED";
      permissionInputs[key] = checkbox;
    }
    const savePermissions = append(permissionBox, "button", "small-action-button", "Save permissions");
    savePermissions.type = "button";
    savePermissions.disabled = dealer.verificationStatus !== "VERIFIED";
    savePermissions.title = dealer.verificationStatus !== "VERIFIED" ? "Approve this dealer before granting feature access." : "";
    savePermissions.addEventListener("click", () => handleDealerPermissions(
      dealer.id,
      Object.fromEntries(Object.entries(permissionInputs).map(([key, checkbox]) => [key, checkbox.checked])),
    ));
    return card;
}

function renderAdminDealers(dealers) {
  const pending = dealers.filter((dealer) => dealer.verificationStatus === "PENDING");
  const allContainer = $("#adminDealers");
  const pendingContainer = $("#adminOverviewDealers");
  allContainer.replaceChildren(...dealers.map(makeAdminDealerCard));
  pendingContainer.replaceChildren(...pending.map(makeAdminDealerCard));
  $("#adminDealersEmpty").classList.toggle("hidden", dealers.length > 0);
  $("#adminOverviewDealersEmpty").classList.toggle("hidden", pending.length > 0);
  $("#pendingDealerCount").textContent = String(dealers.filter((dealer) => dealer.verificationStatus === "PENDING").length);
}

async function handleVerification(dealerId, status) {
  try {
    await post(`/api/admin/dealers/${encodeURIComponent(dealerId)}/verification`, {
      status,
      reason: status === "VERIFIED" ? "Approved for local demo only." : "Not approved for local demo leads.",
    });
    setMessage($("#adminMessage"), `Dealer ${status.toLowerCase()} for this local demo only.`);
    await loadAdminData();
  } catch (error) {
    setMessage($("#adminMessage"), error.message, true);
  }
}

async function handleDealerPermissions(dealerId, permissions) {
  try {
    await post(`/api/admin/dealers/${encodeURIComponent(dealerId)}/permissions`, permissions);
    setMessage($("#adminMessage"), "Dealer feature permissions updated.");
    await loadAdminData();
  } catch (error) {
    setMessage($("#adminMessage"), error.message, true);
  }
}

function renderAdminGroups(groups) {
  const container = $("#adminGroups");
  container.replaceChildren(...groups.map((group) => {
    const card = node("article", "admin-group-card");
    append(card, "b", "", groupHeading(group));
    append(card, "small", "", `${group.city} · ${group.memberCount}/${group.targetMemberCount} buyers · ${group.status.toLowerCase().replaceAll("_", " ")}`);
    return card;
  }));
  $("#adminGroupsEmpty").classList.toggle("hidden", groups.length > 0);
  $("#adminGroupCount").textContent = String(groups.length);
}

function renderAdminDeals(deals) {
  const container = $("#adminDeals");
  container.replaceChildren(...deals.map((deal) => {
    const card = node("article", "admin-deal-card");
    const header = append(card, "div", "admin-deal-heading");
    const identity = append(header, "div", "");
    append(identity, "b", "", deal.vehicle);
    append(identity, "small", "", `${deal.city} · ${deal.memberCount}/${deal.targetMemberCount} buyers · ${deal.status.toLowerCase().replaceAll("_", " ")}`);
    const badge = append(header, "span", "status-tag", `${deal.quotes.length} quotes`);
    if (!deal.quotes.length) append(card, "p", "admin-deal-empty", "No dealer quotations submitted.");
    for (const quote of deal.quotes) {
      const details = append(card, "details", "admin-quote-details");
      const summary = append(details, "summary", "");
      append(summary, "b", "", `${quote.dealerName} · ${quote.quoteReference} · revision ${quote.revision}`);
      append(summary, "strong", "", rupees.format(quote.onRoadTotal));
      const quoteBody = append(details, "div", "admin-quote-body");
      append(quoteBody, "p", "", `${quote.vehicleVariant || deal.vehicle} · ${quote.vehicleColour || "Colour not supplied"} · ${quote.status.toLowerCase().replaceAll("_", " ")}`);
      append(quoteBody, "p", "", `Outlet: ${quote.dealerLocation || "Not supplied"} · Salesperson: ${quote.salespersonName || "Not supplied"} · Manager: ${quote.managerName || "Not supplied"}`);
      append(quoteBody, "p", "", `Dealer authorisation reference: ${quote.authorizationReference || "Not supplied"} · demo status: ${quote.dealerDemoApprovalStatus || "unknown"}`);
      const amounts = [
        ["Ex-showroom", quote.exShowroom],
        ["GST included (informational)", quote.gstIncludedAmount],
        ["Dealer discount", -quote.dealerDiscount],
        ["Manufacturer benefit", -quote.manufacturerBenefit],
        ["Insurance", quote.insuranceAmount],
        ["RTO / registration", quote.registrationAmount],
        ["Road / state tax", quote.roadTaxAmount],
        ["TCS", quote.tcsAmount],
        ["Other taxes", quote.otherTaxesAmount],
        ["FASTag", quote.fastagAmount],
        ["Hypothecation", quote.hypothecationAmount],
        ["Accessories", quote.accessoriesAmount],
        ["Handling", quote.handlingAmount],
        ["Logistics", quote.logisticsAmount],
        ["Other charges", quote.otherCharges],
      ];
      const list = append(quoteBody, "div", "admin-quote-amounts");
      for (const [label, amount] of amounts) {
        const line = append(list, "span", "", `${label}: ${amount < 0 ? "−" : ""}${rupees.format(Math.abs(amount || 0))}`);
        if (label === "GST included (informational)") line.append(" · included in ex-showroom; not added again");
      }
      append(quoteBody, "b", "admin-quote-total", `On-road per car: ${rupees.format(quote.onRoadTotal)} · Group total: ${rupees.format(quote.groupOnRoadTotal)}`);
      append(quoteBody, "small", "", `${quote.deliveryEstimate} · ${quote.stockStatus.toLowerCase()} stock · valid until ${new Date(quote.validUntil).toLocaleDateString("en-IN")} · ${quote.terms || "No additional terms"}`);
    }
    return card;
  }));
  $("#adminDealsEmpty").classList.toggle("hidden", deals.length > 0);
}

function renderAdminPayments(data) {
  const { entries, summary } = data;
  const container = $("#adminPayments");
  container.replaceChildren(...entries.map((entry) => {
    const row = node("article", "admin-ledger-row");
    const info = append(row, "div", "admin-ledger-info");
    append(info, "b", "", `${entry.kind.replaceAll("_", " ")} · ${entry.buyerName} (${entry.buyerPhoneMasked})`);
    append(info, "small", "", `${entry.vehicle} · ${entry.city} · ${entry.status.replaceAll("_", " ").toLowerCase()} · ${new Date(entry.createdAt).toLocaleString("en-IN")}`);
    append(row, "strong", entry.amount < 0 ? "ledger-refund" : "", `${entry.amount < 0 ? "−" : ""}${rupees.format(Math.abs(entry.amount))}`);
    return row;
  }));
  $("#adminPaymentsEmpty").classList.toggle("hidden", entries.length > 0);
  $("#adminPaymentCount").textContent = String(summary.recordCount);
  $("#adminEntryFeeCount").textContent = String(summary.entryFeeCount);
  $("#adminRefundCount").textContent = String(summary.refundCount);
  $("#adminPurchaseFeeCount").textContent = String(summary.purchaseFeeCount);
  $("#adminPaymentDisclaimer").textContent = `Net simulated ledger: ${rupees.format(summary.netRecordedAmount)}. This is a demo record only; real payments collected: no.`;
}

function renderAdminAccess(data) {
  const container = $("#adminAccess");
  container.replaceChildren(...data.accounts.map((account) => {
    const card = node("article", "admin-access-row");
    const info = append(card, "div", "admin-access-info");
    append(info, "b", "", `${account.displayName || account.role} · ${account.role}`);
    append(info, "small", "", `${account.phoneMasked} · ${account.city || "No city"} · ${account.make || "No make"} · ${account.activeSessions} active session(s)`);
    if (account.verificationStatus) {
      append(info, "span", `status-tag ${account.verificationStatus === "VERIFIED" ? "confirmed" : ""}`, account.verificationStatus.toLowerCase());
    }
    if (account.activeSessions > 0 && account.id !== state.user.id) {
      const revoke = append(card, "button", "revoke-access-button", "Revoke sessions");
      revoke.type = "button";
      revoke.addEventListener("click", async () => {
        if (!window.confirm(`Revoke all active sessions for ${account.displayName || account.role} (${account.phoneMasked})?`)) return;
        try {
          const result = await post(`/api/admin/users/${encodeURIComponent(account.id)}/revoke-sessions`, {});
          setMessage($("#adminMessage"), `${result.revokedSessionCount} session(s) revoked.`);
          await loadAdminData();
        } catch (error) {
          setMessage($("#adminMessage"), error.message, true);
        }
      });
    }
    return card;
  }));
  $("#adminAccessEmpty").classList.toggle("hidden", data.accounts.length > 0);
}

function renderAdminIssues(issues) {
  const container = $("#adminIssues");
  container.replaceChildren(...issues.map((issue) => {
    const card = node("article", "issue-card");
    const top = append(card, "div", "issue-card-heading");
    append(top, "b", "", `${issue.category.replaceAll("_", " ")} · ${issue.reporterRole}: ${issue.reporterName || "account"} (${issue.reporterPhoneMasked})`);
    append(top, "small", "", new Date(issue.createdAt).toLocaleString("en-IN"));
    append(card, "p", "", issue.description);
    if (issue.groupId) append(card, "small", "", `Group: ${issue.groupId}`);
    const controls = append(card, "div", "issue-admin-controls");
    const status = append(controls, "select");
    for (const value of ["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"]) {
      const option = node("option", "", value.replaceAll("_", " ").toLowerCase());
      option.value = value;
      status.append(option);
    }
    status.value = issue.status;
    const note = append(controls, "textarea");
    note.rows = 2;
    note.maxLength = 1000;
    note.placeholder = "Admin note for the reporter";
    note.value = issue.adminNote || "";
    const save = append(controls, "button", "small-action-button", "Update ticket");
    save.type = "button";
    save.addEventListener("click", async () => {
      try {
        await post(`/api/admin/issues/${encodeURIComponent(issue.id)}`, {
          status: status.value,
          admin_note: note.value.trim(),
        });
        setMessage($("#adminMessage"), "Issue ticket updated.");
        await loadAdminData();
      } catch (error) {
        setMessage($("#adminMessage"), error.message, true);
      }
    });
    return card;
  }));
  $("#adminIssuesEmpty").classList.toggle("hidden", issues.length > 0);
}

function downloadCsv(filename, headers, rows) {
  const escapeCell = (value) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const content = [headers, ...rows]
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
  const link = node("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAdminDeals() {
  const headers = ["Vehicle", "City", "Members", "Target", "Group status", "Dealer", "Quote reference", "Revision", "Quote status", "On-road per car", "Group on-road total", "Valid until"];
  const rows = state.adminDeals.flatMap((deal) => {
    if (!deal.quotes.length) {
      return [[deal.vehicle, deal.city, deal.memberCount, deal.targetMemberCount, deal.status, "", "", "", "", "", "", ""]];
    }
    return deal.quotes.map((quote) => [
      deal.vehicle, deal.city, deal.memberCount, deal.targetMemberCount, deal.status,
      quote.dealerName, quote.quoteReference, quote.revision, quote.status,
      quote.onRoadTotal, quote.groupOnRoadTotal, quote.validUntil,
    ]);
  });
  downloadCsv("convoy-deals.csv", headers, rows);
}

function exportAdminPayments() {
  const headers = ["Vehicle", "City", "Customer", "Masked phone", "Payment type", "Amount", "Status", "Recorded at"];
  const rows = state.adminPaymentEntries.map((entry) => [
    entry.vehicle, entry.city, entry.buyerName, entry.buyerPhoneMasked,
    entry.kind, entry.amount, entry.status, entry.createdAt,
  ]);
  downloadCsv("convoy-payments-demo.csv", headers, rows);
}

function exportAdminInventory() {
  const headers = ["Dealer", "Make", "Model", "Year", "Variant", "Fuel", "Transmission", "Colour", "City", "Quantity", "Stock status", "Expected delivery", "Masked dealer phone"];
  const rows = state.adminInventory.map((item) => [
    item.dealerName, item.make, item.model, item.modelYear, item.variant,
    item.fuelType, item.transmission, item.colour, item.city, item.quantity,
    item.stockStatus, item.expectedDelivery, item.dealerPhoneMasked,
  ]);
  downloadCsv("convoy-inventory-demo.csv", headers, rows);
}

function exportAdminRatings() {
  const headers = ["Dealer", "Vehicle", "Rating", "Comment", "Created at"];
  const rows = state.adminRatings.map((item) => [
    item.dealerName, item.vehicle, item.rating, item.comment, item.createdAt,
  ]);
  downloadCsv("convoy-ratings.csv", headers, rows);
}

function exportAdminIssues() {
  const headers = ["Category", "Reporter role", "Reporter", "Masked phone", "Group ID", "Description", "Status", "Admin note", "Created at"];
  const rows = state.adminIssues.map((item) => [
    item.category, item.reporterRole, item.reporterName, item.reporterPhoneMasked,
    item.groupId, item.description, item.status, item.adminNote, item.createdAt,
  ]);
  downloadCsv("convoy-issues.csv", headers, rows);
}

function renderAdminAudit(logs) {
  const container = $("#adminAudit");
  container.replaceChildren(...logs.map((entry) => {
    const row = node("article", "admin-audit-row");
    const info = append(row, "div", "");
    append(info, "b", "", `${entry.action.replaceAll("_", " ")} · ${entry.entityType}`);
    append(info, "small", "", `${entry.entityId} · actor ${entry.actorFingerprint} · ${new Date(entry.createdAt).toLocaleString("en-IN")}`);
    const details = JSON.stringify(entry.details || {});
    if (details !== "{}") append(row, "code", "", details);
    return row;
  }));
  $("#adminAuditEmpty").classList.toggle("hidden", logs.length > 0);
}

function exportAdminAudit() {
  const headers = ["Action", "Entity type", "Entity ID", "Actor fingerprint", "Details", "Created at"];
  const rows = state.adminAudit.map((entry) => [
    entry.action, entry.entityType, entry.entityId, entry.actorFingerprint,
    JSON.stringify(entry.details || {}), entry.createdAt,
  ]);
  downloadCsv("convoy-audit-log.csv", headers, rows);
}

async function loadAdminData() {
  const [dealers, groups, deals, payments, access, inventory, ratings, issues, audit] = await Promise.all([
    api("/api/admin/dealers"),
    api("/api/admin/groups"),
    api("/api/admin/deals"),
    api("/api/admin/payments"),
    api("/api/admin/access"),
    api("/api/admin/inventory"),
    api("/api/admin/ratings"),
    api("/api/admin/issues"),
    api("/api/admin/audit"),
  ]);
  state.adminGroups = groups;
  state.adminDeals = deals;
  state.adminPaymentEntries = payments.entries;
  state.adminInventory = inventory;
  state.adminRatings = ratings.ratings;
  state.adminIssues = issues;
  state.adminAudit = audit;
  renderAdminDealers(dealers);
  renderAdminGroups(groups);
  renderAdminDeals(deals);
  renderAdminPayments(payments);
  renderAdminAccess(access);
  renderInventory($("#adminInventory"), inventory, true);
  $("#adminInventoryEmpty").classList.toggle("hidden", inventory.length > 0);
  renderRatings($("#adminRatings"), ratings.ratings);
  $("#adminRatingSummary").textContent = ratings.count
    ? `${ratings.average}/5 · ${ratings.count} rating(s)`
    : "No ratings";
  $("#adminRatingsEmpty").classList.toggle("hidden", ratings.count > 0);
  renderAdminIssues(issues);
  renderAdminAudit(audit);
}

async function handleAddDealer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, "Adding dealer…");
  setMessage($("#adminMessage"), "");
  try {
    const dealer = await post("/api/admin/dealers", {
      phone: $("#adminDealerPhone").value.trim(),
      dealer_name: $("#adminDealerName").value.trim(),
      city: $("#adminDealerCity").value,
      make: $("#adminDealerMake").value,
    });
    form.reset();
    setMessage($("#adminMessage"), `${dealer.dealerName} added as a pending dealer account.`);
    await loadAdminData();
  } catch (error) {
    setMessage($("#adminMessage"), error.message, true);
  } finally {
    setBusy(button, false);
  }
}

function setAdminTab(tabName) {
  $$(".admin-tab").forEach((tab) => tab.classList.toggle("hidden", tab.id !== `adminTab${tabName[0].toUpperCase()}${tabName.slice(1)}`));
  $$(".admin-tab-button").forEach((button) => {
    const active = button.dataset.adminTab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function openWorkspace() {
  try {
    const response = await api("/api/auth/me");
    state.user = response.user;
    state.role = response.user.role;
    showRoleView(state.role);
    if (state.role === "CUSTOMER") await loadCustomerData();
    if (state.role === "DEALER") await loadDealerData();
    if (state.role === "ADMIN") await loadAdminData();
  } catch (error) {
    showLogin();
    if (error.message !== "Sign in to continue." && !error.message.includes("session expired")) {
      setMessage($("#loginMessage"), error.message, true);
    }
  }
}

function wireEvents() {
  $$(".role-choice").forEach((button) => {
    button.addEventListener("click", () => {
      state.role = button.dataset.role;
      $$(".role-choice").forEach((choice) => choice.classList.toggle("active", choice === button));
      updateRoleFields();
      setMessage($("#loginMessage"), "");
    });
  });

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage($("#loginMessage"), "");
    const button = $("#requestOtpButton");
    setBusy(button, true, "Requesting code…");
    try {
      const result = await post("/api/auth/request-otp", {
        phone: $("#phoneInput").value.trim(),
        role: state.role,
      });
      $("#loginForm").classList.add("hidden");
      $("#otpForm").classList.remove("hidden");
      $("#otpInput").focus();
      setMessage($("#loginMessage"), `${result.message} Enter ${result.demoOtp} to continue.`);
    } catch (error) {
      setMessage($("#loginMessage"), error.message, true);
    } finally {
      setBusy(button, false);
    }
  });

  $("#otpForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage($("#loginMessage"), "");
    const button = event.currentTarget.querySelector('button[type="submit"]');
    setBusy(button, true, "Verifying…");
    const body = {
      phone: $("#phoneInput").value.trim(),
      role: state.role,
      otp: $("#otpInput").value.trim(),
      name: $("#nameInput").value.trim(),
      dealer_name: $("#dealerInput").value.trim(),
      city: $("#dealerCityInput").value,
      make: $("#dealerMakeInput").value,
    };
    try {
      const response = await post("/api/auth/verify-otp", body);
      state.user = response.user;
      state.role = response.user.role;
      await openWorkspace();
    } catch (error) {
      setMessage($("#loginMessage"), error.message, true);
    } finally {
      setBusy(button, false);
    }
  });

  $("#backToPhoneButton").addEventListener("click", () => {
    $("#otpForm").classList.add("hidden");
    $("#loginForm").classList.remove("hidden");
    $("#otpInput").value = "";
    setMessage($("#loginMessage"), "");
  });
  $("#logoutButton").addEventListener("click", async () => {
    try {
      await post("/api/auth/logout", {});
    } finally {
      state.user = null;
      $("#otpForm").classList.add("hidden");
      $("#loginForm").classList.remove("hidden");
      $("#otpInput").value = "";
      showLogin();
    }
  });
  $("#orderMake").addEventListener("change", refreshModels);
  $("#groupCityFilter").addEventListener("change", () => loadCustomerData().catch((error) => window.alert(error.message)));
  $("#refreshCustomerButton").addEventListener("click", () => loadCustomerData().catch((error) => window.alert(error.message)));
  $("#groupForm").addEventListener("submit", handleCreateGroup);
  $("#customerIssueForm").addEventListener("submit", (event) => handleIssueForm(event, "customer"));
  $("#customerProfileForm").addEventListener("submit", handleCustomerProfile);
  $("#customerProfileForm").addEventListener("input", (event) => {
    if (event.target.id === "profileFullName") event.currentTarget.dataset.edited = "true";
  });
  $("#profilePan").addEventListener("input", (event) => {
    event.target.value = event.target.value.toUpperCase();
  });
  $("#refreshDealerButton").addEventListener("click", () => loadDealerData().catch((error) => window.alert(error.message)));
  $("#dealerLeadSearch").addEventListener("input", renderDealerGroups);
  $("#dealerLeadQuoteFilter").addEventListener("change", renderDealerGroups);
  $("#dealerQuoteForm").addEventListener("submit", handleDealerQuote);
  $("#dealerInventoryForm").addEventListener("submit", handleInventoryForm);
  $("#dealerIssueForm").addEventListener("submit", (event) => handleIssueForm(event, "dealer"));
  $("#dealerQuoteForm").addEventListener("input", updateQuoteFormRequirements);
  $("#dealerQuoteForm").addEventListener("change", (event) => {
    updateQuoteFormRequirements();
    if (event.target.id === "dealerGroupSelect") updateDealerSelectedVehicle();
  });
  $("#refreshDealerApproval").addEventListener("click", openWorkspace);
  $("#refreshAdminButton").addEventListener("click", () => loadAdminData().catch((error) => setMessage($("#adminMessage"), error.message, true)));
  $("#exportDealsButton").addEventListener("click", exportAdminDeals);
  $("#exportPaymentsButton").addEventListener("click", exportAdminPayments);
  $("#exportInventoryButton").addEventListener("click", exportAdminInventory);
  $("#exportRatingsButton").addEventListener("click", exportAdminRatings);
  $("#exportIssuesButton").addEventListener("click", exportAdminIssues);
  $("#exportAuditButton").addEventListener("click", exportAdminAudit);
  $("#adminDealerForm").addEventListener("submit", handleAddDealer);
  $$(".admin-tab-button").forEach((button) => {
    button.addEventListener("click", () => setAdminTab(button.dataset.adminTab));
  });
}

async function start() {
  $("#purchaseEndDate").min = localDateOffset(1);
  $("#purchaseEndDate").value = localDateOffset(14);
  $("#quoteValidUntil").min = localDateOffset(1);
  $("#quoteValidUntil").value = localDateOffset(7);
  $("#otherChargesExplanationField").classList.add("hidden");
  wireEvents();
  updateRoleFields();
  try {
    state.catalog = await api("/api/catalog");
    populateCatalog();
  } catch (error) {
    setMessage($("#loginMessage"), error.message, true);
  }
  await checkDatabase();
  await openWorkspace();
  updateQuoteFormRequirements();
}

start();
