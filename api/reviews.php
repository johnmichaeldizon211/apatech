<?php
header("Content-Type: application/json; charset=utf-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Accept");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    http_response_code(204);
    exit;
}

function json_response($payload, $status = 200)
{
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

function read_config()
{
    $config = [
        "host" => getenv("DB_HOST") ?: "127.0.0.1",
        "port" => getenv("DB_PORT") ?: "3306",
        "name" => getenv("DB_NAME") ?: "",
        "user" => getenv("DB_USER") ?: "",
        "pass" => getenv("DB_PASSWORD") ?: ""
    ];

    $scriptDir = isset($_SERVER["SCRIPT_FILENAME"]) ? dirname($_SERVER["SCRIPT_FILENAME"]) : "";
    $docRoot = isset($_SERVER["DOCUMENT_ROOT"]) ? rtrim($_SERVER["DOCUMENT_ROOT"], "/") : "";

    $basePaths = array_filter(array_unique([
        __DIR__,
        dirname(__DIR__),
        dirname(dirname(__DIR__)),
        $scriptDir,
        $docRoot,
        $docRoot ? ($docRoot . "/APATECH") : ""
    ]));

    $overridePaths = [];
    foreach ($basePaths as $basePath) {
        $overridePaths[] = $basePath . "/reviews-config.php";
        $overridePaths[] = $basePath . "/api/reviews-config.php";
    }
    $overridePaths = array_unique(array_filter($overridePaths));

    $configSource = "";
    foreach ($overridePaths as $overridePath) {
        if (!$overridePath || !is_readable($overridePath)) {
            continue;
        }
        $DB_HOST = $DB_PORT = $DB_NAME = $DB_USER = $DB_PASSWORD = null;
        $override = include $overridePath;
        if (is_array($override)) {
            $config = array_merge($config, $override);
            $configSource = $overridePath;
            break;
        }
        $localConfig = [];
        if (!empty($DB_HOST)) {
            $localConfig["host"] = $DB_HOST;
        }
        if (!empty($DB_PORT)) {
            $localConfig["port"] = $DB_PORT;
        }
        if (!empty($DB_NAME)) {
            $localConfig["name"] = $DB_NAME;
        }
        if (!empty($DB_USER)) {
            $localConfig["user"] = $DB_USER;
        }
        if (isset($DB_PASSWORD) && $DB_PASSWORD !== "") {
            $localConfig["pass"] = $DB_PASSWORD;
        }
        if (!empty($localConfig)) {
            $config = array_merge($config, $localConfig);
            $configSource = $overridePath;
            break;
        }
    }

    if (isset($_GET["debug"]) && $_GET["debug"] === "1") {
        $checks = [];
        foreach ($overridePaths as $path) {
            if (!$path) {
                continue;
            }
            $checks[] = [
                "path" => $path,
                "exists" => file_exists($path),
                "readable" => is_readable($path)
            ];
        }
        json_response([
            "success" => false,
            "debug" => [
                "script_dir" => $scriptDir,
                "doc_root" => $docRoot,
                "config_found" => !empty($config["name"]) && !empty($config["user"]),
                "config_source" => $configSource ?: null,
                "paths" => $checks
            ]
        ]);
    }

    return $config;
}

function connect_db($config)
{
    if (empty($config["name"]) || empty($config["user"])) {
        json_response([
            "success" => false,
            "message" => "Database credentials are missing."
        ], 500);
    }

    $dsn = sprintf(
        "mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4",
        $config["host"],
        $config["port"],
        $config["name"]
    );

    try {
        $pdo = new PDO($dsn, $config["user"], $config["pass"], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]);
        return $pdo;
    } catch (Exception $error) {
        json_response([
            "success" => false,
            "message" => "Unable to connect to database.",
            "error" => $error->getMessage()
        ], 500);
    }
}

function ensure_reviews_table($pdo)
{
    $sql = "CREATE TABLE IF NOT EXISTS ebike_reviews (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id VARCHAR(64) NOT NULL,
        product_id VARCHAR(120) NOT NULL,
        product_name VARCHAR(180) NOT NULL,
        user_email VARCHAR(190) NULL,
        reviewer_name VARCHAR(120) NOT NULL,
        rating TINYINT UNSIGNED NOT NULL,
        review_text TEXT NOT NULL,
        images_json LONGTEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_ebike_reviews_order_id (order_id),
        KEY idx_ebike_reviews_product (product_id),
        KEY idx_ebike_reviews_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;";
    $pdo->exec($sql);
}

function normalize_product_id($value)
{
    $slug = strtolower(trim((string) $value));
    $slug = preg_replace("/model\\s*:/i", "", $slug);
    $slug = preg_replace("/[^a-z0-9]+/", "-", $slug);
    $slug = trim($slug, "-");
    return $slug;
}

function is_delivered_status($status, $fulfillment)
{
    $merged = strtolower(trim($status . " " . $fulfillment));
    return strpos($merged, "delivered") !== false
        || strpos($merged, "completed") !== false
        || strpos($merged, "complete") !== false;
}

function get_base_url()
{
    $scheme = (!empty($_SERVER["HTTPS"]) && $_SERVER["HTTPS"] !== "off") ? "https" : "http";
    $host = $_SERVER["HTTP_HOST"] ?? "localhost";
    return $scheme . "://" . $host;
}

function map_image_paths($paths)
{
    $baseUrl = get_base_url();
    $output = [];
    foreach ($paths as $path) {
        if (!$path) {
            continue;
        }
        $path = ltrim($path, "/");
        $src = (strpos($path, "http://") === 0 || strpos($path, "https://") === 0)
            ? $path
            : $baseUrl . "/" . $path;
        $output[] = [
            "src" => $src
        ];
    }
    return $output;
}

function fetch_reviews($pdo, $productId)
{
    $stmt = $pdo->prepare("SELECT id, order_id, product_id, product_name, reviewer_name, rating, review_text, images_json, created_at FROM ebike_reviews WHERE product_id = ? ORDER BY created_at DESC");
    $stmt->execute([$productId]);
    $rows = $stmt->fetchAll();

    $reviews = [];
    foreach ($rows as $row) {
        $images = [];
        if (!empty($row["images_json"])) {
            $decoded = json_decode($row["images_json"], true);
            if (is_array($decoded)) {
                $images = $decoded;
            }
        }
        $reviews[] = [
            "id" => (int) $row["id"],
            "orderId" => $row["order_id"],
            "productId" => $row["product_id"],
            "productName" => $row["product_name"],
            "name" => $row["reviewer_name"],
            "rating" => (int) $row["rating"],
            "text" => $row["review_text"],
            "images" => map_image_paths($images),
            "createdAt" => $row["created_at"],
            "displayDate" => date("Y-m-d H:i", strtotime($row["created_at"]))
        ];
    }

    return $reviews;
}

function handle_get($pdo)
{
    $productId = isset($_GET["product_id"]) ? normalize_product_id($_GET["product_id"]) : "";
    if (!$productId) {
        json_response([
            "success" => false,
            "message" => "Missing product_id."
        ], 400);
    }
    $reviews = fetch_reviews($pdo, $productId);
    json_response([
        "success" => true,
        "reviews" => $reviews
    ]);
}

function handle_post($pdo)
{
    $productId = normalize_product_id($_POST["product_id"] ?? "");
    $productName = trim((string) ($_POST["product_name"] ?? ""));
    $orderId = trim((string) ($_POST["order_id"] ?? ""));
    $reviewerName = trim((string) ($_POST["reviewer_name"] ?? "Anonymous"));
    $reviewText = trim((string) ($_POST["review_text"] ?? ""));
    $userEmail = trim((string) ($_POST["user_email"] ?? ""));
    $rating = (int) ($_POST["rating"] ?? 0);

    if (!$productId || !$productName || !$orderId || !$reviewText || $rating < 1 || $rating > 5) {
        json_response([
            "success" => false,
            "message" => "Missing required review fields."
        ], 400);
    }

    $bookingStmt = $pdo->prepare("SELECT status, fulfillment_status FROM bookings WHERE order_id = ? LIMIT 1");
    $bookingStmt->execute([$orderId]);
    $booking = $bookingStmt->fetch();
    if (!$booking) {
        json_response([
            "success" => false,
            "message" => "Booking not found."
        ], 403);
    }
    if (!is_delivered_status($booking["status"] ?? "", $booking["fulfillment_status"] ?? "")) {
        json_response([
            "success" => false,
            "message" => "Review is available only after delivery."
        ], 403);
    }

    $existingStmt = $pdo->prepare("SELECT id FROM ebike_reviews WHERE order_id = ? LIMIT 1");
    $existingStmt->execute([$orderId]);
    if ($existingStmt->fetch()) {
        json_response([
            "success" => false,
            "message" => "Review already submitted."
        ], 409);
    }

    $uploadDir = dirname(__DIR__) . "/uploads/reviews";
    if (!is_dir($uploadDir)) {
        @mkdir($uploadDir, 0775, true);
    }

    $storedPaths = [];
    if (!empty($_FILES["images"]) && isset($_FILES["images"]["name"])) {
        $names = $_FILES["images"]["name"];
        $tmpNames = $_FILES["images"]["tmp_name"];
        $errors = $_FILES["images"]["error"];
        $count = is_array($names) ? count($names) : 0;
        $count = min($count, 3);
        for ($i = 0; $i < $count; $i++) {
            if ($errors[$i] !== UPLOAD_ERR_OK) {
                continue;
            }
            $tmp = $tmpNames[$i];
            if (!is_uploaded_file($tmp)) {
                continue;
            }
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $mime = $finfo->file($tmp);
            $allowed = [
                "image/jpeg" => "jpg",
                "image/png" => "png",
                "image/webp" => "webp"
            ];
            if (!isset($allowed[$mime])) {
                continue;
            }
            $safeOrder = preg_replace("/[^a-zA-Z0-9_-]+/", "", $orderId);
            $filename = sprintf(
                "review_%s_%s_%02d.%s",
                $safeOrder ?: "order",
                date("YmdHis"),
                $i + 1,
                $allowed[$mime]
            );
            $targetPath = $uploadDir . "/" . $filename;
            if (move_uploaded_file($tmp, $targetPath)) {
                $storedPaths[] = "uploads/reviews/" . $filename;
            }
        }
    }

    $insertStmt = $pdo->prepare("INSERT INTO ebike_reviews (order_id, product_id, product_name, user_email, reviewer_name, rating, review_text, images_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $insertStmt->execute([
        $orderId,
        $productId,
        $productName,
        $userEmail,
        $reviewerName,
        $rating,
        $reviewText,
        json_encode($storedPaths)
    ]);

    $reviews = fetch_reviews($pdo, $productId);
    json_response([
        "success" => true,
        "reviews" => $reviews
    ]);
}

$config = read_config();
$pdo = connect_db($config);
ensure_reviews_table($pdo);

if ($_SERVER["REQUEST_METHOD"] === "POST") {
    handle_post($pdo);
}

handle_get($pdo);
