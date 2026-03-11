(function () {
    const INSTALLMENT_CHECKOUT_KEY = "ecodrive_installment_checkout";
    const INSTALLMENT_FORM_KEY = "ecodrive_installment_form";
    const BOOKING_STORAGE_KEYS = ["ecodrive_bookings", "ecodrive_orders", "orders"];
    const KYC_API_BASE = (
        localStorage.getItem("ecodrive_kyc_api_base")
        || localStorage.getItem("ecodrive_api_base")
        || (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function"
            ? window.EcodriveSession.getApiBase()
            : "")
    )
        .trim()
        .replace(/\/+$/, "");
    const PH_LOCATION_TREE = {
        "Bulacan": {
            "Baliwag City": ["Bagong Nayon", "Concepcion", "Makinabang", "Poblacion", "Sabang"],
            "Malolos City": ["Anilao", "Atlag", "Bulihan", "Look 1st", "Santo Rosario"],
            "Meycauayan City": ["Banga", "Calvario", "Camalig", "Iba", "Perez"],
            "San Jose del Monte City": ["Assumption", "Citrus", "Dulong Bayan", "Graceville", "Muzon Proper"],
            "Plaridel": ["Agnaya", "Banga I", "Bagong Silang", "Lumang Bayan", "Poblacion"]
        },
        "Pampanga": {
            "Angeles City": ["Balibago", "Cutcut", "Lourdes Sur", "Pampang", "Pulung Maragul"],
            "City of San Fernando": ["Calulut", "Del Pilar", "Dolores", "San Agustin", "Santo Rosario"],
            "Mabalacat City": ["Dau", "Dolores", "Mawaque", "Poblacion", "Tabun"],
            "Apalit": ["Balucuc", "Capalangan", "Paligui", "Sampaloc", "San Vicente"]
        },
        "Cavite": {
            "Bacoor City": ["Bayanan", "Mambog I", "Molinio III", "Niog", "Talaba II"],
            "Dasmarinas City": ["Burol", "Langkaan I", "Paliparan I", "Poblacion", "Salitran II"],
            "Imus City": ["Alapan I-A", "Anabu I-A", "Bucandala I", "Medicion I-A", "Tanzang Luma I"],
            "General Trias City": ["Bagumbayan", "Biclatan", "Manggahan", "Santiago", "Tapia"]
        },
        "Laguna": {
            "Calamba City": ["Banadero", "Canlubang", "Halang", "Poblacion 1", "Real"],
            "San Pablo City": ["Santiago I", "San Antonio 1", "San Bartolome", "San Cristobal", "San Jose"],
            "Santa Rosa City": ["Balibago", "Caingin", "Dita", "Macabling", "Tagapo"],
            "Binan City": ["Canlalay", "Casile", "Malamig", "Poblacion", "San Antonio"]
        },
        "Rizal": {
            "Antipolo City": ["Cupang", "Dalig", "Dela Paz", "Mambugan", "San Isidro"],
            "Cainta": ["San Andres", "San Isidro", "San Juan", "Santo Domingo", "Santo Nino"],
            "Taytay": ["Dolores", "Muzon", "San Juan", "Santa Ana", "Tikling"],
            "Binangonan": ["Batingan", "Darangan", "Libis", "Pipindan", "Tatala"]
        },
        "Metro Manila": {
            "City of Manila": ["Binondo", "Ermita", "Malate", "Sampaloc", "Tondo I"],
            "Quezon City": ["Batasan Hills", "Commonwealth", "Novaliches Proper", "Pasong Tamo", "Tandang Sora"],
            "Makati City": ["Bel-Air", "Poblacion", "San Antonio", "San Isidro", "Tejeros"],
            "Pasig City": ["Bagong Ilog", "Kapitolyo", "Pinagbuhatan", "Rosario", "Santolan"],
            "Taguig City": ["Fort Bonifacio", "Lower Bicutan", "Pembo", "Pinagsama", "Western Bicutan"]
        }
    };
    const PSGC_API_BASE = "https://psgc.cloud/api/v2";
    const LOCATION_FETCH_TIMEOUT_MS = 15000;
    const REGULAR_PLAN_PRICING_SOURCE = "flyer_regular_dp_2026_02";
    const ALLOWED_REGULAR_MONTHS = ["6", "12", "18", "24"];
    const REGULAR_PLAN_MATRIX = [
        {
            model: "BLITZ 1200",
            battery: "60V 20AH",
            srp: 45000,
            minDp: 3000,
            monthly: { "6": 7970, "12": 4470, "18": 3304, "24": 2720 }
        },
        {
            model: "FUN 350R II",
            battery: "48V 20AH",
            srp: 24000,
            minDp: 1500,
            monthly: { "6": 4270, "12": 2395, "18": 1770, "24": 1457 }
        },
        {
            model: "CANDY 800",
            battery: "48V 20AH",
            srp: 39000,
            minDp: 2000,
            monthly: { "6": 7021, "12": 3938, "18": 2910, "24": 2396 }
        },
        {
            model: "ECONO350 MINI-II",
            battery: "48V 20AH",
            srp: 39000,
            minDp: 1600,
            monthly: { "6": 7215, "12": 4098, "18": 3060, "24": 2540 }
        },
        {
            model: "ECONO 500MP",
            battery: "60V 20AH",
            srp: 51500,
            minDp: 3000,
            monthly: { "6": 9238, "12": 5196, "18": 3849, "24": 3175 }
        },
        {
            model: "ECONO MP 650 48V",
            battery: "48V 32AH",
            srp: 62000,
            minDp: 8000,
            monthly: { "6": 10240, "12": 5740, "18": 4240, "24": 3490 }
        },
        {
            model: "ECONO 800 MP",
            battery: "60V 32AH",
            srp: 60000,
            minDp: 9000,
            monthly: { "6": 9678, "12": 5428, "18": 4011, "24": 3303 }
        },
        {
            model: "ECONO 800 MP II",
            battery: "60V 20AH",
            srp: 63500,
            minDp: 9500,
            monthly: { "6": 10240, "12": 5740, "18": 4240, "24": 3490 }
        },
        {
            model: "ECARGO 100",
            battery: "60V 32AH",
            srp: 72500,
            minDp: 14500,
            monthly: { "6": 11006, "12": 6173, "18": 4562, "24": 3756 }
        },
        {
            model: "E-CARGO 800J",
            battery: "60V 20AH",
            srp: 65000,
            minDp: 10000,
            monthly: { "6": 10437, "12": 5853, "18": 4326, "24": 3562 }
        },
        {
            model: "E-CAB 1000",
            battery: "48V 80AH",
            srp: 75000,
            minDp: 15000,
            monthly: { "6": 11386, "12": 6386, "18": 4719, "24": 3886 }
        },
        {
            model: "ECAB 1000 V2",
            battery: "60V 38AH",
            srp: 90000,
            minDp: 18000,
            monthly: { "6": 13520, "12": 7520, "18": 5520, "24": 4520 }
        },
        {
            model: "TRAVELLER 1500",
            battery: "60V-38AH",
            srp: 78000,
            minDp: 13500,
            monthly: { "6": 12153, "12": 6778, "18": 4987, "24": 4091 }
        },
        {
            model: "E-CAB MAX 1500",
            battery: "60V 32AH",
            srp: 130000,
            minDp: 26000,
            monthly: { "6": 19736, "12": 11068, "18": 8180, "24": 6735 }
        },
        {
            model: "BLITZ 2000 ADV",
            battery: "72V 35AH Graphene",
            srp: 68000,
            minDp: 14000,
            monthly: { "6": 10240, "12": 5740, "18": 4240, "24": 3490 }
        },
        {
            model: "BLITZ 200R",
            battery: "72V 20AH Graphene",
            srp: 74000,
            minDp: 15000,
            monthly: { "6": 11188, "12": 6271, "18": 4633, "24": 3813 }
        }
    ];
    const MODEL_ALIAS_ENTRIES = [
        ["BLITZ 1200", "BLITZ 1200"],
        ["FUN 350R II", "FUN 350R II"],
        ["FUN 350R", "FUN 350R II"],
        ["FUN 1500 FI", "FUN 350R II"],
        ["CANDY 800", "CANDY 800"],
        ["ECONO350 MINI-II", "ECONO350 MINI-II"],
        ["ECONO350 MINI II", "ECONO350 MINI-II"],
        ["ECONO 350 MINI-II", "ECONO350 MINI-II"],
        ["ECONO 350 MINI II", "ECONO350 MINI-II"],
        ["ECONO 500MP", "ECONO 500MP"],
        ["ECONO500 MP", "ECONO 500MP"],
        ["ECONO 500 MP", "ECONO 500MP"],
        ["ECONO MP 650 48V", "ECONO MP 650 48V"],
        ["ECONO MP 650 48 V", "ECONO MP 650 48V"],
        ["ECONO 650 MP", "ECONO MP 650 48V"],
        ["ECONO 650 MP 48V", "ECONO MP 650 48V"],
        ["ECONO 650 48V", "ECONO MP 650 48V"],
        ["ECONO 650MP", "ECONO MP 650 48V"],
        ["ECONO 800 MP", "ECONO 800 MP"],
        ["ECONO 800MP", "ECONO 800 MP"],
        ["ECONO 800 MP II", "ECONO 800 MP II"],
        ["ECARGO 100", "ECARGO 100"],
        ["E-CARGO 100", "ECARGO 100"],
        ["E CARGO 100", "ECARGO 100"],
        ["E-CARGO 800J", "E-CARGO 800J"],
        ["E-CARGO 800", "E-CARGO 800J"],
        ["ECARGO 800J", "E-CARGO 800J"],
        ["ECARGO 800", "E-CARGO 800J"],
        ["E-CAB 1000", "E-CAB 1000"],
        ["ECAB 1000", "E-CAB 1000"],
        ["ECAB 100V V2", "ECAB 1000 V2"],
        ["ECAB 1000 II", "ECAB 1000 V2"],
        ["ECAB 1000 V2", "ECAB 1000 V2"],
        ["TRAVELLER 1500", "TRAVELLER 1500"],
        ["TRAVELER 1500", "TRAVELLER 1500"],
        ["E-CAB MAX 1500", "E-CAB MAX 1500"],
        ["ECAB MAX 1500", "E-CAB MAX 1500"],
        ["BLITZ 2000", "BLITZ 2000 ADV"],
        ["BLITZ 2000 ADV", "BLITZ 2000 ADV"],
        ["BLITZ 200R", "BLITZ 200R"],
        ["BLITZ 200 R", "BLITZ 200R"],
        ["BLITZ200R", "BLITZ 200R"]
    ];
    const ALLOWED_INSTALLMENT_PROVINCE = "Bulacan";
    const ALLOWED_INSTALLMENT_CITY_CONFIG = [
        { canonical: "City of Baliwag", aliases: ["Baliwag City", "City of Baliuag", "Baliuag City", "Baliwag", "Baliuag"] },
        { canonical: "San Ildefonso", aliases: [] },
        { canonical: "San Rafael", aliases: [] },
        { canonical: "Pulilan", aliases: ["Pullilan"] },
        { canonical: "Bustos", aliases: [] }
    ];
    const ALLOWED_INSTALLMENT_CITIES = ALLOWED_INSTALLMENT_CITY_CONFIG
        .map(function (entry) {
            return String(entry.canonical || "").trim();
        })
        .filter(Boolean)
        .sort(function (a, b) {
            return a.localeCompare(b, "en", { sensitivity: "base" });
        });
    const INSTALLMENT_CITY_ALIAS_MAP = ALLOWED_INSTALLMENT_CITY_CONFIG.reduce(function (map, entry) {
        const canonical = String(entry.canonical || "").trim();
        if (!canonical) {
            return map;
        }
        const aliases = [canonical].concat(Array.isArray(entry.aliases) ? entry.aliases : []);
        aliases.forEach(function (alias) {
            const normalized = normalizeLocationText(alias).toLowerCase();
            if (normalized) {
                map.set(normalized, canonical);
            }
        });
        return map;
    }, new Map());
    const INSTALLMENT_FALLBACK_BARANGAYS_BY_CITY = {
        "City of Baliwag": ["Bagong Nayon", "Concepcion", "Makinabang", "Poblacion", "Sabang", "San Jose", "Santo Nino", "Tarcan"],
        "San Ildefonso": ["Akle", "Anyatam", "Bubulong Munti", "Garlang", "Malipampang", "Sapang Putik", "Umpucan"],
        "San Rafael": ["Banca-banca", "Caingin", "Lico", "Maasim", "Poblacion", "Talacsan", "Tukod"],
        "Pulilan": ["Balatong A", "Balatong B", "Cutcot", "Lumbac", "Longos", "Poblacion", "Santa Peregrina"],
        "Bustos": ["Bonga Mayor", "Buisan", "Camachile", "Cambaog", "Poblacion", "Tibagan", "Talampas"]
    };
    const STEP3_REQUIREMENT_DEFINITIONS = [
        { key: "validId1", label: "Valid ID #1", required: true },
        { key: "validId2", label: "Valid ID #2", required: true },
        { key: "proofOfIncome", label: "Proof of Income", required: true },
        { key: "payslipOrCoe", label: "Payslip / COE", requiredWhen: "Employed" },
        { key: "businessPermit", label: "Business Permit", requiredWhen: "Business Owner" },
        { key: "proofOfBilling", label: "Proof of Billing", required: true },
        { key: "brgyCertificate", label: "Barangay Certificate", required: true }
    ];

    function normalizeStep3EmploymentType(value) {
        const raw = String(value || "").trim().toLowerCase();
        if (!raw) {
            return "";
        }
        if (
            raw === "yes"
            || raw === "business owner"
            || raw === "business_owner"
            || raw === "businessowner"
        ) {
            return "Business Owner";
        }
        if (
            raw === "no"
            || raw === "employed"
            || raw === "employee"
        ) {
            return "Employed";
        }
        return "";
    }

    function toBusinessOwnerSelectionValue(value) {
        const employmentType = normalizeStep3EmploymentType(value);
        if (employmentType === "Business Owner") {
            return "Yes";
        }
        if (employmentType === "Employed") {
            return "No";
        }
        return "";
    }

    const profileBtn = document.querySelector(".profile-menu .profile-btn");
    const dropdown = document.querySelector(".profile-menu .dropdown");

    if (profileBtn && dropdown) {
        profileBtn.addEventListener("click", function (event) {
            event.stopPropagation();
            dropdown.classList.toggle("show");
        });

        dropdown.addEventListener("click", function (event) {
            event.stopPropagation();
        });

        document.addEventListener("click", function () {
            dropdown.classList.remove("show");
        });
    }

    function safeParse(raw) {
        try {
            return JSON.parse(raw);
        } catch (_error) {
            return null;
        }
    }

    function getApiUrl(endpoint) {
        return KYC_API_BASE ? `${KYC_API_BASE}${endpoint}` : endpoint;
    }

    function buildApiHeaders(baseHeaders) {
        const headers = Object.assign({}, baseHeaders || {});
        const token = (window.EcodriveSession && typeof window.EcodriveSession.getToken === "function")
            ? String(window.EcodriveSession.getToken() || "").trim()
            : "";
        if (token) {
            headers.Authorization = "Bearer " + token;
        }
        return headers;
    }

    function normalizeModelKey(value) {
        return String(value || "")
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, " ")
            .trim()
            .replace(/\s+/g, " ");
    }

    const REGULAR_PLAN_BY_KEY = REGULAR_PLAN_MATRIX.reduce(function (map, row) {
        const key = normalizeModelKey(row.model);
        if (key) {
            map.set(key, row);
        }
        return map;
    }, new Map());

    const MODEL_ALIASES = MODEL_ALIAS_ENTRIES.reduce(function (map, entry) {
        const alias = normalizeModelKey(entry[0]);
        const canonical = String(entry[1] || "").trim();
        if (alias && canonical) {
            map.set(alias, canonical);
        }
        return map;
    }, new Map());

    function getDraftSrpValue(draft) {
        const subtotal = Number(draft && draft.subtotal);
        if (Number.isFinite(subtotal) && subtotal > 0) {
            return Math.round(subtotal);
        }

        const total = Number(draft && draft.total);
        const shippingFee = Number(draft && draft.shippingFee);
        if (Number.isFinite(total) && total > 0 && Number.isFinite(shippingFee) && shippingFee >= 0) {
            const computed = total - shippingFee;
            if (computed > 0) {
                return Math.round(computed);
            }
        }

        if (Number.isFinite(total) && total > 0) {
            return Math.round(total);
        }

        return 0;
    }

    function resolveRegularPlanForDraft(draft) {
        const modelText = String(draft && draft.model || "").trim();
        const modelKey = normalizeModelKey(modelText);
        const srpValue = getDraftSrpValue(draft);
        let row = null;

        if (modelKey) {
            const canonicalModel = MODEL_ALIASES.get(modelKey) || "";
            if (canonicalModel) {
                row = REGULAR_PLAN_BY_KEY.get(normalizeModelKey(canonicalModel)) || null;
            }

            if (!row) {
                row = REGULAR_PLAN_BY_KEY.get(modelKey) || null;
            }
        }

        if (!row && srpValue > 0) {
            const candidates = REGULAR_PLAN_MATRIX.filter(function (entry) {
                return Number(entry.srp) === srpValue;
            });
            if (candidates.length === 1) {
                row = candidates[0];
            }
        }

        return {
            matched: !!row,
            row: row,
            inputModel: modelText,
            inputSrp: srpValue
        };
    }

    function formatInstallmentPeso(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) {
            return "-";
        }
        return String.fromCharCode(8369) + amount.toLocaleString("en-PH", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
    }

    function normalizeLocationText(value) {
        const raw = String(value || "").trim();
        if (!raw) {
            return "";
        }

        const fixed = raw
            .replace(/\u00C3\u00B1/g, "\u00F1")
            .replace(/\u00C3\u0091/g, "\u00D1")
            .replace(/\u00C3\u00A1/g, "\u00E1")
            .replace(/\u00C3\u00A9/g, "\u00E9")
            .replace(/\u00C3\u00AD/g, "\u00ED")
            .replace(/\u00C3\u00B3/g, "\u00F3")
            .replace(/\u00C3\u00BA/g, "\u00FA")
            .replace(/\u00C3\u00BC/g, "\u00FC")
            .replace(/\u00C2/g, "");

        if (fixed !== raw) {
            return fixed;
        }

        if (typeof TextDecoder === "function" && /[\u00C3\u00C2]/.test(raw)) {
            try {
                const bytes = new Uint8Array(Array.from(raw).map(function (char) {
                    return char.charCodeAt(0) & 255;
                }));
                const decoded = new TextDecoder("utf-8").decode(bytes).trim();
                if (decoded) {
                    return decoded;
                }
            } catch (_error) {
                return raw;
            }
        }

        return raw;
    }

    function normalizeLookupValue(value) {
        return normalizeLocationText(value).toLowerCase();
    }

    function findInsensitiveMatch(options, target) {
        const lookup = normalizeLookupValue(target);
        if (!lookup || !Array.isArray(options)) {
            return "";
        }

        for (let i = 0; i < options.length; i += 1) {
            if (normalizeLookupValue(options[i]) === lookup) {
                return String(options[i]);
            }
        }

        return "";
    }

    function resolveInstallmentCityName(value) {
        const normalized = normalizeLookupValue(value);
        if (!normalized) {
            return "";
        }
        return INSTALLMENT_CITY_ALIAS_MAP.get(normalized) || "";
    }

    function normalizeInstallmentProvinceName(value) {
        const normalized = normalizeLookupValue(value);
        if (!normalized) {
            return "";
        }
        return normalized === normalizeLookupValue(ALLOWED_INSTALLMENT_PROVINCE)
            ? ALLOWED_INSTALLMENT_PROVINCE
            : "";
    }

    function toLocationArray(payload) {
        if (Array.isArray(payload)) {
            return payload;
        }
        if (payload && Array.isArray(payload.data)) {
            return payload.data;
        }
        if (payload && Array.isArray(payload.items)) {
            return payload.items;
        }
        if (payload && Array.isArray(payload.results)) {
            return payload.results;
        }
        return [];
    }

    function normalizeLocationRows(rows) {
        const normalizedRows = (Array.isArray(rows) ? rows : [])
            .map(function (row) {
                if (!row || typeof row !== "object") {
                    return null;
                }

                const name = normalizeLocationText(row.name || row.city || row.municipality || row.barangay || "");
                const code = String(row.code || row.psgc_code || row.id || name).trim();
                if (!name) {
                    return null;
                }

                return {
                    code: code || name,
                    name: name
                };
            })
            .filter(Boolean);

        return normalizedRows.sort(function (a, b) {
            return String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base" });
        });
    }

    function parseShippingAddressParts(addressInput) {
        const normalizedAddress = normalizeLocationText(addressInput).replace(/\s+/g, " ").trim();
        if (!normalizedAddress) {
            return {
                street: "",
                barangay: "",
                city: "",
                province: ""
            };
        }

        const segments = normalizedAddress
            .split(",")
            .map(function (segment) {
                return normalizeLocationText(segment).replace(/\s+/g, " ").trim();
            })
            .filter(Boolean);

        if (segments.length >= 4) {
            return {
                street: segments.slice(0, segments.length - 3).join(", "),
                barangay: segments[segments.length - 3],
                city: segments[segments.length - 2],
                province: segments[segments.length - 1]
            };
        }

        if (segments.length === 3) {
            return {
                street: segments[0],
                barangay: segments[1],
                city: segments[2],
                province: ""
            };
        }

        if (segments.length === 2) {
            return {
                street: segments[0],
                barangay: segments[1],
                city: "",
                province: ""
            };
        }

        return {
            street: normalizedAddress,
            barangay: "",
            city: "",
            province: ""
        };
    }

    function deriveStep2SeedFromCheckoutDraft(existingDataInput) {
        const existingData = existingDataInput && typeof existingDataInput === "object"
            ? existingDataInput
            : {};
        const draft = getCheckoutDraft();
        if (!draft || typeof draft !== "object") {
            return Object.assign({}, existingData);
        }

        const next = Object.assign({}, existingData);
        if (!next.personalEmail && draft.email) {
            next.personalEmail = String(draft.email).trim();
        }

        const shippingAddressParts = draft.shippingAddressParts && typeof draft.shippingAddressParts === "object"
            ? draft.shippingAddressParts
            : null;
        if (shippingAddressParts) {
            if (!next.street && shippingAddressParts.street) {
                next.street = normalizeLocationText(shippingAddressParts.street);
            }
            const canonicalCity = resolveInstallmentCityName(shippingAddressParts.city);
            if (!next.city && canonicalCity) {
                next.city = canonicalCity;
            }
            if (!next.province) {
                const province = normalizeInstallmentProvinceName(shippingAddressParts.province);
                if (province) {
                    next.province = province;
                }
            }
            if (!next.barangay && shippingAddressParts.barangay) {
                next.barangay = normalizeLocationText(shippingAddressParts.barangay);
            }
        }

        const shippingAddress = String(draft.shippingAddress || "").trim();
        const serviceText = String(draft.service || "").trim().toLowerCase();
        const commaCount = shippingAddress ? shippingAddress.split(",").length : 0;
        const shouldSeedAddress = shippingAddress && (
            serviceText.includes("deliver")
            || serviceText.includes("home service")
            || commaCount >= 3
        );

        if (!shouldSeedAddress) {
            return next;
        }

        const parsedAddress = parseShippingAddressParts(shippingAddress);
        if (!next.street && parsedAddress.street) {
            next.street = parsedAddress.street;
        }
        if (!next.province && parsedAddress.province) {
            const canonicalProvince = normalizeInstallmentProvinceName(parsedAddress.province);
            if (canonicalProvince) {
                next.province = canonicalProvince;
            }
        }
        if (!next.city && parsedAddress.city) {
            const canonicalCity = resolveInstallmentCityName(parsedAddress.city);
            if (canonicalCity) {
                next.city = canonicalCity;
            }
        }
        if (!next.barangay && parsedAddress.barangay) {
            next.barangay = parsedAddress.barangay;
        }

        return next;
    }

    async function fetchLocationRows(url) {
        const controller = new AbortController();
        const timeout = setTimeout(function () {
            controller.abort();
        }, LOCATION_FETCH_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                },
                signal: controller.signal
            });
            if (!response.ok) {
                throw new Error("Location API unavailable.");
            }

            const payload = await response.json().catch(function () {
                return [];
            });
            return normalizeLocationRows(toLocationArray(payload));
        } finally {
            clearTimeout(timeout);
        }
    }

    function buildFallbackProvinceRows() {
        return Object.keys(PH_LOCATION_TREE)
            .sort(function (a, b) {
                return a.localeCompare(b);
            })
            .map(function (provinceName) {
                return {
                    code: "fallback:" + provinceName,
                    name: provinceName
                };
            });
    }

    function buildFallbackCityRows(provinceName) {
        const cityMap = PH_LOCATION_TREE[String(provinceName || "").trim()];
        if (!cityMap || typeof cityMap !== "object") {
            return [];
        }

        return Object.keys(cityMap)
            .sort(function (a, b) {
                return a.localeCompare(b);
            })
            .map(function (cityName) {
                return {
                    code: "fallback:" + provinceName + ":" + cityName,
                    name: cityName
                };
            });
    }

    function buildFallbackBarangayRows(provinceName, cityName) {
        const cityMap = PH_LOCATION_TREE[String(provinceName || "").trim()];
        const list = cityMap ? cityMap[String(cityName || "").trim()] : null;
        if (!Array.isArray(list)) {
            return [];
        }

        return list
            .slice()
            .sort(function (a, b) {
                return String(a).localeCompare(String(b));
            })
            .map(function (barangayName) {
                return {
                    code: "fallback:" + provinceName + ":" + cityName + ":" + barangayName,
                    name: String(barangayName)
                };
            });
    }

    function renderSelectOptions(selectEl, options, placeholder, selectedValue) {
        if (!selectEl) {
            return "";
        }

        const normalizedOptions = Array.isArray(options)
            ? options.map(function (item) {
                return String(item || "").trim();
            }).filter(Boolean)
            : [];
        const uniqueOptions = Array.from(new Set(normalizedOptions));
        const selectedRaw = String(selectedValue || "").trim();
        const selectedMatch = findInsensitiveMatch(uniqueOptions, selectedRaw);

        selectEl.innerHTML = "";
        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = placeholder;
        selectEl.appendChild(placeholderOption);

        uniqueOptions.forEach(function (optionValue) {
            const option = document.createElement("option");
            option.value = optionValue;
            option.textContent = optionValue;
            selectEl.appendChild(option);
        });

        if (selectedMatch) {
            selectEl.value = selectedMatch;
            return selectedMatch;
        }

        if (selectedRaw) {
            const customOption = document.createElement("option");
            customOption.value = selectedRaw;
            customOption.textContent = selectedRaw;
            selectEl.appendChild(customOption);
            selectEl.value = selectedRaw;
            return selectedRaw;
        }

        selectEl.value = "";
        return "";
    }

    function setSelectLoadingState(selectEl, loadingText) {
        if (!selectEl) {
            return;
        }

        selectEl.innerHTML = "";
        const option = document.createElement("option");
        option.value = "";
        option.textContent = loadingText;
        selectEl.appendChild(option);
        selectEl.disabled = true;
    }

    function setupStep2LocationSelectors(seedData) {
        const provinceSelect = document.getElementById("province");
        const citySelect = document.getElementById("city");
        const barangaySelect = document.getElementById("barangay");
        const barangayCacheByCity = new Map();
        const psgcCityCodeByCanonical = new Map();

        if (!provinceSelect || !citySelect || !barangaySelect) {
            return;
        }

        function applyLockedProvince() {
            renderSelectOptions(
                provinceSelect,
                [ALLOWED_INSTALLMENT_PROVINCE],
                "Select province",
                ALLOWED_INSTALLMENT_PROVINCE
            );
            provinceSelect.value = ALLOWED_INSTALLMENT_PROVINCE;
            provinceSelect.disabled = true;
        }

        async function preloadAllowedPsgcCities() {
            if (psgcCityCodeByCanonical.size) {
                return;
            }

            let provinceRows = [];
            try {
                provinceRows = await fetchLocationRows(PSGC_API_BASE + "/provinces");
            } catch (_error) {
                provinceRows = [];
            }
            const bulacanRow = provinceRows.find(function (row) {
                return normalizeLookupValue(row && row.name) === normalizeLookupValue(ALLOWED_INSTALLMENT_PROVINCE);
            });
            if (!bulacanRow || !bulacanRow.code) {
                return;
            }

            let cityRows = [];
            try {
                cityRows = await fetchLocationRows(
                    PSGC_API_BASE + "/provinces/" + encodeURIComponent(bulacanRow.code) + "/cities-municipalities"
                );
            } catch (_error) {
                cityRows = [];
            }

            cityRows.forEach(function (row) {
                const canonical = resolveInstallmentCityName(row && row.name);
                if (canonical && !psgcCityCodeByCanonical.has(canonical)) {
                    psgcCityCodeByCanonical.set(canonical, String(row.code || ""));
                }
            });
        }

        async function loadBarangaysForCity(cityName, selectedBarangay) {
            const canonicalCity = resolveInstallmentCityName(cityName);
            if (!canonicalCity) {
                renderSelectOptions(barangaySelect, [], "Select barangay", "");
                barangaySelect.disabled = true;
                return;
            }
            citySelect.value = canonicalCity;
            setSelectLoadingState(barangaySelect, "Loading barangays...");

            let barangayNames = barangayCacheByCity.get(canonicalCity) || [];
            if (!barangayNames.length) {
                await preloadAllowedPsgcCities();
                const cityCode = psgcCityCodeByCanonical.get(canonicalCity) || "";
                let rows = [];
                if (cityCode) {
                    try {
                        rows = await fetchLocationRows(
                            PSGC_API_BASE + "/cities-municipalities/" + encodeURIComponent(cityCode) + "/barangays"
                        );
                    } catch (_error) {
                        rows = [];
                    }
                }

                barangayNames = rows.map(function (row) {
                    return row.name;
                });
                if (!barangayNames.length) {
                    barangayNames = INSTALLMENT_FALLBACK_BARANGAYS_BY_CITY[canonicalCity] || [];
                }
                const normalizedBarangays = Array.from(new Set(
                    barangayNames
                        .map(function (item) {
                            return normalizeLocationText(item);
                        })
                        .filter(Boolean)
                )).sort(function (a, b) {
                    return String(a).localeCompare(String(b), "en", { sensitivity: "base" });
                });
                barangayCacheByCity.set(canonicalCity, normalizedBarangays);
                barangayNames = normalizedBarangays;
            }

            renderSelectOptions(
                barangaySelect,
                barangayNames,
                "Select barangay",
                selectedBarangay
            );
            barangaySelect.disabled = !barangayNames.length;
        }

        provinceSelect.addEventListener("change", function () {
            provinceSelect.value = ALLOWED_INSTALLMENT_PROVINCE;
        });

        citySelect.addEventListener("change", function () {
            void loadBarangaysForCity(citySelect.value, "");
        });

        applyLockedProvince();
        const seededCity = resolveInstallmentCityName(seedData && seedData.city);
        renderSelectOptions(
            citySelect,
            ALLOWED_INSTALLMENT_CITIES,
            "Select city / municipality",
            seededCity || ""
        );
        citySelect.disabled = false;
        void loadBarangaysForCity(seededCity || citySelect.value, seedData && seedData.barangay);
    }

    async function saveBookingToApi(record) {
        try {
            const response = await fetch(getApiUrl("/api/bookings"), {
                method: "POST",
                headers: buildApiHeaders({
                    "Content-Type": "application/json"
                }),
                body: JSON.stringify(record)
            });

            if (response.status === 404 || response.status === 405) {
                return {
                    success: false,
                    message: "Booking service is currently unavailable."
                };
            }

            if (response.status === 401 || response.status === 403) {
                return {
                    success: false,
                    message: "Your session has expired. Please log in again."
                };
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || !payload || payload.success !== true) {
                return {
                    success: false,
                    message: String((payload && payload.message) || "Unable to sync booking to server.")
                };
            }

            return {
                success: true,
                message: "",
                booking: payload.booking && typeof payload.booking === "object"
                    ? payload.booking
                    : null
            };
        } catch (_error) {
            return {
                success: false,
                message: "Network error while saving booking. Please try again."
            };
        }
    }

    function getCheckoutDraft() {
        const parsed = safeParse(localStorage.getItem(INSTALLMENT_CHECKOUT_KEY));
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        return parsed;
    }

    function getInstallmentFormData() {
        const parsed = safeParse(localStorage.getItem(INSTALLMENT_FORM_KEY));
        if (parsed && typeof parsed === "object") {
            return parsed;
        }
        return {};
    }

    function createKycFlowId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return "kyc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }

    function setInstallmentFormData(nextData) {
        localStorage.setItem(INSTALLMENT_FORM_KEY, JSON.stringify(nextData));
    }

    function getRecordOrderId(record) {
        return String((record && (record.orderId || record.id)) || "")
            .trim()
            .toLowerCase();
    }

    function getRecordInstallmentFlowId(record) {
        if (!record || typeof record !== "object") {
            return "";
        }
        const installment = record.installment && typeof record.installment === "object"
            ? record.installment
            : null;
        return String(
            (installment && (installment.kycFlowId || installment.kyc_flow_id))
            || record.kycFlowId
            || record.kyc_flow_id
            || ""
        )
            .trim()
            .toLowerCase();
    }

    function appendRecordToStorage(storageKey, record) {
        const parsed = safeParse(localStorage.getItem(storageKey));
        const list = Array.isArray(parsed) ? parsed : [];
        const incomingOrderId = getRecordOrderId(record);

        if (incomingOrderId) {
            const existingIndex = list.findIndex(function (item) {
                return getRecordOrderId(item) === incomingOrderId;
            });

            if (existingIndex >= 0) {
                list[existingIndex] = Object.assign({}, list[existingIndex], record);
                localStorage.setItem(storageKey, JSON.stringify(list));
                return;
            }
        }

        list.push(record);
        localStorage.setItem(storageKey, JSON.stringify(list));
    }

    function removeRecordsByOrderIds(storageKey, orderIds) {
        const ids = Array.isArray(orderIds)
            ? orderIds
                .map(function (value) {
                    return String(value || "").trim().toLowerCase();
                })
                .filter(Boolean)
            : [];
        if (!ids.length) {
            return;
        }

        const parsed = safeParse(localStorage.getItem(storageKey));
        if (!Array.isArray(parsed)) {
            return;
        }

        const next = parsed.filter(function (item) {
            const itemOrderId = getRecordOrderId(item);
            return !itemOrderId || !ids.includes(itemOrderId);
        });
        localStorage.setItem(storageKey, JSON.stringify(next));
    }

    function cleanupInstallmentFlowDuplicates(storageKey, canonicalRecord) {
        const canonicalFlowId = getRecordInstallmentFlowId(canonicalRecord);
        const canonicalOrderId = getRecordOrderId(canonicalRecord);
        if (!canonicalFlowId || !canonicalOrderId) {
            return;
        }

        const parsed = safeParse(localStorage.getItem(storageKey));
        if (!Array.isArray(parsed)) {
            return;
        }

        const next = parsed.filter(function (item) {
            const flowId = getRecordInstallmentFlowId(item);
            if (!flowId || flowId !== canonicalFlowId) {
                return true;
            }
            const itemOrderId = getRecordOrderId(item);
            return !itemOrderId || itemOrderId === canonicalOrderId;
        });
        localStorage.setItem(storageKey, JSON.stringify(next));
    }

    function redirectToBooking() {
        window.location.href = "../payment/booking.html";
    }

    const step = document.body.getAttribute("data-step");
    if (step !== "4" && !getCheckoutDraft()) {
        redirectToBooking();
        return;
    }

    function seedStep2() {
        const storedData = getInstallmentFormData();
        const data = deriveStep2SeedFromCheckoutDraft(storedData);
        if (JSON.stringify(data) !== JSON.stringify(storedData)) {
            setInstallmentFormData(data);
        }
        const fields = [
            "firstName", "middleName", "lastName", "gender", "age", "personalEmail",
            "cellphone", "zipCode", "street", "civilStatus", "dob",
            "nationality", "monthsToPay"
        ];

        fields.forEach(function (fieldId) {
            const input = document.getElementById(fieldId);
            if (input && data[fieldId]) {
                input.value = data[fieldId];
            }
        });

        const emailInput = document.getElementById("personalEmail");
        if (emailInput && !emailInput.value && data.personalEmail) {
            emailInput.value = data.personalEmail;
        }

        return data;
    }

    function seedStep3() {
        const data = getInstallmentFormData();
        const employmentTypeInput = document.getElementById("employmentType");
        if (employmentTypeInput) {
            const normalized = normalizeStep3EmploymentType(
                data.employmentType || data.employment_type || data.ownerType || data.workType
            );
            employmentTypeInput.value = normalized;
        }

        const uploads = data.requirementsUploads && typeof data.requirementsUploads === "object"
            ? data.requirementsUploads
            : {};
        STEP3_REQUIREMENT_DEFINITIONS.forEach(function (definition) {
            const nameNode = document.getElementById(definition.key + "Name");
            if (!nameNode) {
                return;
            }
            const meta = uploads[definition.key] && typeof uploads[definition.key] === "object"
                ? uploads[definition.key]
                : null;
            const fileName = String(meta && meta.fileName || "").trim();
            nameNode.textContent = fileName || "No file selected";
        });
    }

    async function appendBookingRecord(record) {
        const apiResult = await saveBookingToApi(record);
        if (!apiResult || apiResult.success !== true) {
            return apiResult || { success: false, message: "Unable to sync booking to server." };
        }

        const persistedRecord = apiResult.booking && typeof apiResult.booking === "object"
            ? Object.assign({}, record, apiResult.booking)
            : Object.assign({}, record);
        const removeOrderIds = [
            record && (record.orderId || record.id),
            persistedRecord && (persistedRecord.orderId || persistedRecord.id)
        ];

        BOOKING_STORAGE_KEYS.forEach(function (key) {
            removeRecordsByOrderIds(key, removeOrderIds);
            cleanupInstallmentFlowDuplicates(key, persistedRecord);
            appendRecordToStorage(key, persistedRecord);
        });
        localStorage.setItem("latestBooking", JSON.stringify(persistedRecord));
        return { success: true, message: "", booking: persistedRecord };
    }

    function setupStep1Notice() {
        const form = document.getElementById("installmentNoticeForm");
        const error = document.getElementById("idStepError");

        if (!form) {
            return;
        }

        form.addEventListener("submit", function (event) {
            event.preventDefault();
            if (error) {
                error.textContent = "";
            }

            const timestamp = new Date().toISOString();
            const existing = deriveStep2SeedFromCheckoutDraft(getInstallmentFormData());
            const next = {
                ...existing,
                idType: "Requirements Review",
                kycFlowId: existing.kycFlowId || createKycFlowId(),
                kycFlowStage: "face-verified",
                idVerified: true,
                idImageDataUrl: "",
                idVerificationToken: "",
                idVerificationSource: "manual-requirement",
                idVerificationReason: "Customer reviewed installment requirements.",
                idVerifiedAt: timestamp,
                faceVerified: true,
                faceDistance: "",
                faceVerifiedAt: timestamp,
                identityVerifiedAt: timestamp,
                termsAgree: true,
                manualPhotoReminder: false,
                requirementsReviewedAt: timestamp
            };

            setInstallmentFormData(next);
            window.location.href = "installment-step2.html";
        });
    }

    function setupStep2() {
        const identity = getInstallmentFormData();
        if (!identity.idVerified || !identity.faceVerified || identity.kycFlowStage !== "face-verified") {
            window.location.href = "installment-step1.html";
            return;
        }

        const form = document.getElementById("installmentStep2Form");
        const error = document.getElementById("step2Error");
        const planError = document.getElementById("step2PlanError");
        const planPanel = document.getElementById("regularPlanPanel");
        const selectedModelEl = document.getElementById("planSelectedModel");
        const batteryEl = document.getElementById("planBattery");
        const srpEl = document.getElementById("planSrp");
        const minDpEl = document.getElementById("planMinDp");
        const monthlyEl = document.getElementById("planMonthlyAmortization");
        const monthsSelect = document.getElementById("monthsToPay");
        const dobInput = document.getElementById("dob");
        const ageInput = document.getElementById("age");
        const submitBtn = form ? form.querySelector("button[type='submit']") : null;
        if (!form) {
            return;
        }

        const seededData = seedStep2();
        setupStep2LocationSelectors(seededData);

        function parseDobDate(value) {
            const cleaned = String(value || "").trim();
            const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) {
                return null;
            }
            const year = Number(match[1]);
            const month = Number(match[2]) - 1;
            const day = Number(match[3]);
            const parsed = new Date(year, month, day, 0, 0, 0, 0);
            if (
                Number.isNaN(parsed.getTime())
                || parsed.getFullYear() !== year
                || parsed.getMonth() !== month
                || parsed.getDate() !== day
            ) {
                return null;
            }
            return parsed;
        }

        function getAgeFromDob(dobValue) {
            const parsed = parseDobDate(dobValue);
            if (!parsed) {
                return "";
            }
            const today = new Date();
            let age = today.getFullYear() - parsed.getFullYear();
            const monthDiff = today.getMonth() - parsed.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsed.getDate())) {
                age -= 1;
            }
            return Number.isFinite(age) && age >= 0 ? String(age) : "";
        }

        function updateAgeFromDob(dobValue) {
            if (!ageInput) {
                return;
            }
            ageInput.value = getAgeFromDob(dobValue);
        }

        function getDobRange() {
            const min = new Date(1945, 0, 1, 0, 0, 0, 0);
            const max = new Date();
            max.setHours(0, 0, 0, 0);
            return { min, max };
        }

        function isDobWithinRange(value) {
            const parsed = parseDobDate(value);
            if (!parsed) {
                return false;
            }
            const range = getDobRange();
            return parsed.getTime() >= range.min.getTime() && parsed.getTime() <= range.max.getTime();
        }

        if (dobInput) {
            const range = getDobRange();
            const pad = function (value) {
                return String(value).padStart(2, "0");
            };
            const maxValue = [
                range.max.getFullYear(),
                pad(range.max.getMonth() + 1),
                pad(range.max.getDate())
            ].join("-");
            dobInput.min = "1945-01-01";
            dobInput.max = maxValue;

            const validateDobInput = function () {
                const raw = dobInput.value || "";
                if (!raw) {
                    dobInput.setCustomValidity("");
                    if (ageInput) {
                        ageInput.value = "";
                    }
                    return;
                }
                if (!isDobWithinRange(raw)) {
                    const parsed = parseDobDate(raw);
                    const range = getDobRange();
                    if (parsed && parsed.getTime() > range.max.getTime()) {
                        const pad = function (value) {
                            return String(value).padStart(2, "0");
                        };
                        const clamped = [
                            range.max.getFullYear(),
                            pad(range.max.getMonth() + 1),
                            pad(range.max.getDate())
                        ].join("-");
                        dobInput.value = clamped;
                        dobInput.setCustomValidity("");
                        updateAgeFromDob(clamped);
                        return;
                    }
                    dobInput.setCustomValidity("Date of birth must be between 1945 and the current year.");
                    if (ageInput) {
                        ageInput.value = "";
                    }
                } else {
                    dobInput.setCustomValidity("");
                    updateAgeFromDob(raw);
                }
            };

            dobInput.addEventListener("input", validateDobInput);
            dobInput.addEventListener("change", validateDobInput);
            dobInput.addEventListener("blur", validateDobInput);
            updateAgeFromDob(dobInput.value);
        }

        const draft = getCheckoutDraft() || {};
        const planState = {
            matchStatus: "unknown_model_blocked",
            row: null,
            monthsToPay: "",
            monthlyAmortization: 0
        };

        function setPlanField(target, text) {
            if (!target) {
                return;
            }
            target.textContent = text;
        }

        function setSubmitEnabled(enabled) {
            if (!submitBtn) {
                return;
            }
            submitBtn.disabled = !enabled;
        }

        function setPlanBlocked(message) {
            planState.matchStatus = "unknown_model_blocked";
            planState.row = null;
            planState.monthsToPay = "";
            planState.monthlyAmortization = 0;

            if (planPanel) {
                planPanel.classList.add("plan-blocked");
            }
            if (monthsSelect) {
                monthsSelect.disabled = true;
                monthsSelect.value = "";
            }

            setPlanField(selectedModelEl, String(draft.model || "").trim() || "-");
            setPlanField(batteryEl, "-");
            setPlanField(srpEl, getDraftSrpValue(draft) > 0 ? formatInstallmentPeso(getDraftSrpValue(draft)) : "-");
            setPlanField(minDpEl, "-");
            setPlanField(monthlyEl, "-");

            if (planError) {
                planError.textContent = message;
            }
            setSubmitEnabled(false);
        }

        function updateMonthlyPreview() {
            if (!monthsSelect || !planState.row) {
                return;
            }

            const months = String(monthsSelect.value || "").trim();
            if (!ALLOWED_REGULAR_MONTHS.includes(months)) {
                planState.monthsToPay = "";
                planState.monthlyAmortization = 0;
                setPlanField(monthlyEl, "-");
                return;
            }

            const monthlyValue = Number(planState.row.monthly[months] || 0);
            if (!Number.isFinite(monthlyValue) || monthlyValue <= 0) {
                planState.monthsToPay = "";
                planState.monthlyAmortization = 0;
                setPlanField(monthlyEl, "-");
                return;
            }

            planState.monthsToPay = months;
            planState.monthlyAmortization = monthlyValue;
            setPlanField(monthlyEl, formatInstallmentPeso(monthlyValue) + " / month");
        }

        function setPlanMatched(row) {
            planState.matchStatus = "matched";
            planState.row = row;

            if (planPanel) {
                planPanel.classList.remove("plan-blocked");
            }
            if (monthsSelect) {
                monthsSelect.disabled = false;
            }

            setPlanField(selectedModelEl, row.model);
            setPlanField(batteryEl, row.battery);
            setPlanField(srpEl, formatInstallmentPeso(row.srp));
            setPlanField(minDpEl, formatInstallmentPeso(row.minDp));

            const existingMonths = String((seededData && seededData.monthsToPay) || (monthsSelect && monthsSelect.value) || "").trim();
            const defaultMonths = ALLOWED_REGULAR_MONTHS.includes(existingMonths) ? existingMonths : "6";
            if (monthsSelect) {
                monthsSelect.value = defaultMonths;
            }
            updateMonthlyPreview();

            if (planError) {
                planError.textContent = "";
            }
            setSubmitEnabled(true);
        }

        const resolvedPlan = resolveRegularPlanForDraft(draft);
        if (!resolvedPlan.matched || !resolvedPlan.row) {
            setPlanBlocked("Installment rates for this model are not yet available online. Please contact Ecodrive branch.");
        } else {
            setPlanMatched(resolvedPlan.row);
        }

        if (monthsSelect) {
            monthsSelect.addEventListener("change", function () {
                if (planError && planState.matchStatus === "matched") {
                    planError.textContent = "";
                }
                updateMonthlyPreview();
            });
        }

        form.addEventListener("submit", function (event) {
            event.preventDefault();
            if (error) {
                error.textContent = "";
            }
            if (planError) {
                planError.textContent = "";
            }

            if (planState.matchStatus !== "matched" || !planState.row) {
                if (planError) {
                    planError.textContent = "Installment rates for this model are not yet available online. Please contact Ecodrive branch.";
                }
                return;
            }

            if (!ALLOWED_REGULAR_MONTHS.includes(planState.monthsToPay)) {
                if (planError) {
                    planError.textContent = "Please select a valid installment plan month.";
                }
                if (monthsSelect) {
                    monthsSelect.focus();
                }
                return;
            }

            if (!Number.isFinite(planState.monthlyAmortization) || planState.monthlyAmortization <= 0) {
                if (planError) {
                    planError.textContent = "Unable to compute monthly hulog for the selected plan.";
                }
                return;
            }

            const data = {
                firstName: (document.getElementById("firstName").value || "").trim(),
                middleName: (document.getElementById("middleName").value || "").trim(),
                lastName: (document.getElementById("lastName").value || "").trim(),
                gender: (document.getElementById("gender").value || "").trim(),
                age: (document.getElementById("age").value || "").trim(),
                personalEmail: (document.getElementById("personalEmail").value || "").trim(),
                province: normalizeInstallmentProvinceName(document.getElementById("province").value || ""),
                cellphone: (document.getElementById("cellphone").value || "").trim(),
                zipCode: (document.getElementById("zipCode").value || "").trim(),
                street: (document.getElementById("street").value || "").trim(),
                city: resolveInstallmentCityName(document.getElementById("city").value || ""),
                barangay: (document.getElementById("barangay").value || "").trim(),
                civilStatus: (document.getElementById("civilStatus").value || "").trim(),
                dob: (document.getElementById("dob").value || "").trim(),
                nationality: (document.getElementById("nationality").value || "").trim(),
                monthsToPay: planState.monthsToPay
            };

            if (!data.firstName || !data.lastName || !data.gender || !data.age || !data.personalEmail || !data.province || !data.cellphone || !data.zipCode || !data.street || !data.city || !data.barangay || !data.civilStatus || !data.dob || !data.nationality || !data.monthsToPay) {
                if (error) {
                    error.textContent = "Please complete all required fields.";
                }
                return;
            }

            if (data.province !== ALLOWED_INSTALLMENT_PROVINCE) {
                if (error) {
                    error.textContent = "Installment service area is limited to Bulacan.";
                }
                return;
            }
            if (!ALLOWED_INSTALLMENT_CITIES.includes(data.city)) {
                if (error) {
                    error.textContent = "City must be City of Baliwag, San Ildefonso, San Rafael, Pulilan, or Bustos.";
                }
                return;
            }
            const barangaySelect = document.getElementById("barangay");
            const selectedBarangay = normalizeLocationText(data.barangay);
            const availableBarangays = barangaySelect instanceof HTMLSelectElement
                ? Array.from(barangaySelect.options).map(function (option) {
                    return normalizeLocationText(option.value);
                }).filter(Boolean)
                : [];
            if (!selectedBarangay || !availableBarangays.includes(selectedBarangay)) {
                if (error) {
                    error.textContent = "Please select a valid barangay for the selected city.";
                }
                return;
            }
            data.barangay = selectedBarangay;

            const ageValue = Number(data.age);
            if (!Number.isFinite(ageValue) || ageValue < 18) {
                if (error) {
                    error.textContent = "Applicant must be at least 18 years old.";
                }
                return;
            }

            if (!isDobWithinRange(data.dob)) {
                if (error) {
                    error.textContent = "Date of birth must be between 1945 and the current year.";
                }
                if (dobInput) {
                    dobInput.focus();
                }
                return;
            }

            const merged = {
                ...getInstallmentFormData(),
                ...data,
                planType: "regular_down_payment",
                pricingSource: REGULAR_PLAN_PRICING_SOURCE,
                planModel: planState.row.model,
                planBattery: planState.row.battery,
                planSrp: Number(planState.row.srp || 0),
                planMinDp: Number(planState.row.minDp || 0),
                monthlyAmortization: Number(planState.monthlyAmortization || 0),
                planMatchStatus: planState.matchStatus
            };
            setInstallmentFormData(merged);
            window.location.href = "installment-step3.html";
        });
    }

    function setupStep3() {
        const identity = getInstallmentFormData();
        if (!identity.idVerified || !identity.faceVerified || identity.kycFlowStage !== "face-verified") {
            window.location.href = "installment-step1.html";
            return;
        }

        const form = document.getElementById("installmentStep3Form");
        const error = document.getElementById("step3Error");
        const employmentTypeInput = document.getElementById("employmentType");
        const payslipWrap = document.getElementById("payslipOrCoeWrap");
        const businessPermitWrap = document.getElementById("businessPermitWrap");
        const payslipBody = document.getElementById("payslipOrCoeBody");
        const businessPermitBody = document.getElementById("businessPermitBody");
        const toggleButtons = Array.from(document.querySelectorAll(".toggle-btn[data-employment]"));
        if (!form) {
            return;
        }
        if (!employmentTypeInput) {
            return;
        }
        const submitButton = form.querySelector('button[type="submit"]');
        const submitButtonDefaultLabel = submitButton ? submitButton.textContent : "";
        let submitInFlight = false;
        const requirementNodes = STEP3_REQUIREMENT_DEFINITIONS.map(function (definition) {
            return {
                key: definition.key,
                label: definition.label,
                required: Boolean(definition.required),
                requiredWhen: definition.requiredWhen || "",
                input: document.getElementById(definition.key),
                fileName: document.getElementById(definition.key + "Name")
            };
        });

        function setSubmitState(inFlight) {
            submitInFlight = Boolean(inFlight);
            if (!submitButton) {
                return;
            }
            submitButton.disabled = submitInFlight;
            submitButton.textContent = submitInFlight
                ? "Submitting..."
                : submitButtonDefaultLabel;
        }

        function isRequirementApplicable(definition, employmentType) {
            if (!definition || !definition.requiredWhen) {
                return true;
            }
            return definition.requiredWhen === employmentType;
        }

        function isRequirementRequired(definition, employmentType) {
            if (!definition) {
                return false;
            }
            if (definition.required) {
                return true;
            }
            return Boolean(definition.requiredWhen) && definition.requiredWhen === employmentType;
        }

        function setToggleState(type, value) {
            toggleButtons.forEach(function (button) {
                if ((button.getAttribute("data-employment") || "") !== type) {
                    return;
                }
                const isActive = (button.getAttribute("data-value") || "") === value;
                button.classList.toggle("active", isActive);
            });
        }

        function syncEmploymentTogglesFromInput() {
            const employmentType = normalizeStep3EmploymentType(employmentTypeInput.value);
            if (employmentType === "Employed") {
                setToggleState("Employed", "Yes");
                setToggleState("Business Owner", "No");
                return;
            }
            if (employmentType === "Business Owner") {
                setToggleState("Business Owner", "Yes");
                setToggleState("Employed", "No");
                return;
            }
            setToggleState("Employed", "No");
            setToggleState("Business Owner", "No");
        }

        function setEmploymentType(nextType) {
            employmentTypeInput.value = nextType;
            syncEmploymentTogglesFromInput();
            syncConditionalRequirementFields();
        }

        function setFileNameLabel(definition) {
            if (!definition || !definition.fileName || !definition.input) {
                return;
            }
            const file = definition.input.files && definition.input.files[0] ? definition.input.files[0] : null;
            definition.fileName.textContent = file ? String(file.name || "").trim() : "No file selected";
        }

        function syncConditionalRequirementFields() {
            const employmentType = normalizeStep3EmploymentType(employmentTypeInput.value);
            const isEmployed = employmentType === "Employed";
            const isBusinessOwner = employmentType === "Business Owner";

            if (payslipBody) {
                payslipBody.hidden = !isEmployed;
            }
            if (businessPermitBody) {
                businessPermitBody.hidden = !isBusinessOwner;
            }

            requirementNodes.forEach(function (definition) {
                if (!definition || !definition.input) {
                    return;
                }
                definition.input.required = isRequirementRequired(definition, employmentType);
                if (!isRequirementApplicable(definition, employmentType) && definition.input.value) {
                    definition.input.value = "";
                    if (definition.fileName) {
                        definition.fileName.textContent = "No file selected";
                    }
                }
            });
        }

        function readFileAsDataUrl(file) {
            return new Promise(function (resolve, reject) {
                if (!file) {
                    resolve("");
                    return;
                }
                const reader = new FileReader();
                reader.onload = function () {
                    resolve(String(reader.result || ""));
                };
                reader.onerror = function () {
                    reject(new Error("Unable to read attachment: " + String(file.name || "file")));
                };
                reader.readAsDataURL(file);
            });
        }

        seedStep3();
        syncEmploymentTogglesFromInput();
        requirementNodes.forEach(function (definition) {
            if (!definition || !definition.input) {
                return;
            }
            setFileNameLabel(definition);
            definition.input.addEventListener("change", function () {
                setFileNameLabel(definition);
                if (error) {
                    error.textContent = "";
                }
            });
        });
        toggleButtons.forEach(function (button) {
            button.addEventListener("click", function () {
                const type = button.getAttribute("data-employment") || "";
                const value = button.getAttribute("data-value") || "";
                const current = normalizeStep3EmploymentType(employmentTypeInput.value);
                if (value === "Yes") {
                    setEmploymentType(type);
                } else {
                    if (current === type) {
                        setEmploymentType("");
                    } else {
                        setToggleState(type, "No");
                        syncConditionalRequirementFields();
                    }
                }
                if (error) {
                    error.textContent = "";
                }
            });
        });
        syncConditionalRequirementFields();

        form.addEventListener("submit", async function (event) {
            event.preventDefault();
            if (submitInFlight) {
                return;
            }
            setSubmitState(true);

            let submitSucceeded = false;
            try {
                if (error) {
                    error.textContent = "";
                }

                const employmentType = normalizeStep3EmploymentType(employmentTypeInput.value);
                if (!employmentType) {
                    if (error) {
                        error.textContent = "Please select if you are employed or a business owner.";
                    }
                    return;
                }

                const missing = requirementNodes.find(function (definition) {
                    if (!definition || !definition.input) {
                        return false;
                    }
                    if (!isRequirementRequired(definition, employmentType)) {
                        return false;
                    }
                    const file = definition.input.files && definition.input.files[0] ? definition.input.files[0] : null;
                    return !file;
                });
                if (missing) {
                    if (error) {
                        error.textContent = missing.label + " is required.";
                    }
                    return;
                }

                const uploadsMetadata = {};
                const uploadsPayload = {};
                for (const definition of requirementNodes) {
                    if (!definition || !definition.input) {
                        continue;
                    }
                    if (!isRequirementApplicable(definition, employmentType)) {
                        continue;
                    }
                    const file = definition.input.files && definition.input.files[0] ? definition.input.files[0] : null;
                    if (!file) {
                        continue;
                    }

                    const uploadedAt = new Date().toISOString();
                    const baseMeta = {
                        fileName: String(file.name || definition.key).trim(),
                        mime: String(file.type || "").trim(),
                        sizeBytes: Number(file.size || 0),
                        uploadedAt: uploadedAt
                    };
                    uploadsMetadata[definition.key] = baseMeta;
                    uploadsPayload[definition.key] = Object.assign(
                        {},
                        baseMeta,
                        { dataUrl: await readFileAsDataUrl(file) }
                    );
                }

                const mergedForStorage = {
                    ...getInstallmentFormData(),
                    employmentType: employmentType,
                    requirementsUploads: uploadsMetadata,
                    submittedAt: new Date().toISOString()
                };
                setInstallmentFormData(mergedForStorage);

                const draft = getCheckoutDraft();
                if (!draft) {
                    redirectToBooking();
                    return;
                }

                const bookingRecord = {
                    orderId: draft.orderId,
                    fullName: draft.fullName,
                    email: draft.email,
                    phone: draft.phone,
                    model: draft.model,
                    bikeColor: String(draft.bikeColor || draft.color || "").trim(),
                    color: String(draft.bikeColor || draft.color || "").trim(),
                    bikeImage: draft.bikeImage,
                    total: draft.total,
                    payment: draft.payment,
                    service: "Installment",
                    scheduleDate: draft.scheduleDate || "",
                    scheduleTime: draft.scheduleTime || "",
                    bookingDate: draft.scheduleDate || "",
                    bookingTime: draft.scheduleTime || "",
                    date: draft.scheduleDate || "",
                    time: draft.scheduleTime || "",
                    scheduledAt: draft.scheduledAt || "",
                    scheduleLabel: draft.scheduleLabel || "",
                    status: "Application Review",
                    fulfillmentStatus: "Under Review",
                    createdAt: new Date().toISOString(),
                    installment: Object.assign({}, mergedForStorage, {
                        requirementsUploads: uploadsPayload
                    })
                };

                const saveResult = await appendBookingRecord(bookingRecord);
                if (!saveResult || saveResult.success !== true) {
                    if (error) {
                        error.textContent = (saveResult && saveResult.message) || "Unable to submit installment booking right now.";
                    }
                    return;
                }
                submitSucceeded = true;
                localStorage.removeItem(INSTALLMENT_CHECKOUT_KEY);
                window.location.href = "installment-success.html";
            } finally {
                if (!submitSucceeded) {
                    setSubmitState(false);
                }
            }
        });
    }

    if (step === "1-id") {
        setupStep1Notice();
    }

    if (step === "1-face") {
        window.location.href = "installment-step1.html";
        return;
    }

    if (step === "2") {
        setupStep2();
    }

    if (step === "3") {
        setupStep3();
    }

    if (step === "4") {
        localStorage.removeItem(INSTALLMENT_FORM_KEY);
    }
})();



