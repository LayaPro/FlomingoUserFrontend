import { useEffect, useState, useCallback } from "react";
import "./App.css";
import axios from "axios";
import config from "./config/config";

interface ImageData {
  id: string;
  url: string;
  width: number;
  height: number;
  loaded: boolean;
  position?: { top: number; left: number; width: number };
}

interface FolderData {
  name: string;
  path: string;
}

function App() {
  const [images, setImages] = useState<ImageData[]>([]);
  const [displayedImages, setDisplayedImages] = useState<ImageData[]>([]);
  const [columns, setColumns] = useState<ImageData[][]>([[], [], [], [], []]); // 5 separate columns
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const imagesPerBatch = 5; // Load 5 images at a time
  const [bannerUrl, setBannerUrl] = useState<string>("");
  const [folders, setFolders] = useState<FolderData[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>("");

  // Fetch folders from S3
  useEffect(() => {
    const fetchFolders = async () => {
      try {
        const path = window.location.search.substring(1);
        const [bucketName = config.defaultBucket] = path.split("/");
        const decodedBucketName = decodeURIComponent(bucketName);

        const response = await axios.get(`${config.apiBaseUrl}/list-folders`, {
          params: {
            bucketName: decodedBucketName,
          },
        });

        if (response.data && response.data.folders) {
          const folderList = response.data.folders.map(
            (folderName: string) => ({
              name: folderName,
              path: folderName,
            })
          );
          setFolders(folderList);

          // Get folder from URL if present
          const path = window.location.search.substring(1);
          const [, urlFolder] = path.split("/");
          const decodedUrlFolder = urlFolder
            ? decodeURIComponent(urlFolder)
            : "";

          if (
            decodedUrlFolder &&
            folderList.some(
              (f: { path: string }) => f.path === decodedUrlFolder
            )
          ) {
            // If URL folder exists in the list, set it as active
            setActiveFolder(decodedUrlFolder);
          } else if (folderList.length > 0) {
            // Otherwise use first folder as default
            setActiveFolder(folderList[0].path);
            // Update URL with the default folder
            updateUrlWithFolder(folderList[0].path);
          }
        }
      } catch (error) {
        console.error("Failed to fetch folders:", error);
      }
    };

    fetchFolders();
  }, []);

  // Watch for active folder changes and fetch images
  useEffect(() => {
    const fetchImagesForFolder = async () => {
      if (activeFolder) {
        try {
          setLoading(true);
          setImages([]);
          setDisplayedImages([]);
          setColumns([[], [], [], [], []]);
          setCurrentBatch(0);

          const path = window.location.search.substring(1);
          const [bucketName = config.defaultBucket] = path.split("/");
          const decodedBucketName = decodeURIComponent(bucketName);
          const prefix = `${activeFolder}/`;

          const response = await axios.get(`${config.apiBaseUrl}/get-images`, {
            params: {
              bucketName: decodedBucketName,
              prefix,
            },
          });

          if (response.data.images && response.data.images.length > 0) {
            const imgList: ImageData[] = response.data.images.map(
              (url: string, index: number) => ({
                id: `${index}`,
                url: url,
                width: 0, // Will be set when image loads
                height: 0, // Will be set when image loads
                loaded: false,
              })
            );
            setImages(imgList);
          }
        } catch (error) {
          console.error("Failed to fetch images for folder:", error);
          setImages([]);
        } finally {
          setLoading(false);
        }
      }
    };

    fetchImagesForFolder();
  }, [activeFolder]);

  // Function to update URL when folder changes
  const updateUrlWithFolder = useCallback((folder: string) => {
    const path = window.location.search.substring(1);
    const [bucketName = config.defaultBucket] = path.split("/");
    const newUrl = `${window.location.pathname}?${bucketName}/${folder}`;
    window.history.pushState({}, "", newUrl);
  }, []);

  // Load banner image from S3 cover folder
  useEffect(() => {
    const fetchBannerFromS3 = async () => {
      try {
        // Get bucket name and prefix from URL path
        const path = window.location.search.substring(1); // remove the '?'
        const [bucketName = config.defaultBucket] = path.split("/");
        const decodedBucketName = decodeURIComponent(bucketName);

        // Call your Express server endpoint for banner
        const response = await axios.post(`${config.apiBaseUrl}/get-cover`, {
          bucketName: decodedBucketName,
        });

        // Set the banner URL if available
        console.log("-----------------BANNNER", response.data.url);

        if (response.data.url) {
          setBannerUrl(response.data.url);
        } else {
          console.error("No banner URL in response");
        }
      } catch (error) {
        console.error("Failed to fetch banner:", error);
      }
    };

    fetchBannerFromS3();
  }, []);

  // Load images in batches
  const loadNextBatch = useCallback(async () => {
    if (batchLoading || currentBatch * imagesPerBatch >= images.length) return;

    setBatchLoading(true);
    const startIndex = currentBatch * imagesPerBatch;
    const endIndex = Math.min(startIndex + imagesPerBatch, images.length);
    const batchImages = images.slice(startIndex, endIndex);

    // Preload all images in the batch with retry logic
    const imagePromises = batchImages.map((img) => {
      return new Promise<ImageData>((resolve) => {
        const image = new Image();
        image.onload = () => {
          console.log(`✅ Image loaded successfully: ${img.url}`);
          resolve({
            ...img,
            loaded: true,
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        };
        image.onerror = () => {
          console.log(`❌ Image failed to load: ${img.url}`);
          // Retry once if image fails to load
          const retryImage = new Image();
          retryImage.onload = () => {
            console.log(`✅ Image loaded on retry: ${img.url}`);
            resolve({
              ...img,
              loaded: true,
              width: retryImage.naturalWidth,
              height: retryImage.naturalHeight,
            });
          };
          retryImage.onerror = () => {
            console.log(`❌ Image failed on retry: ${img.url}`);
            resolve({ ...img, loaded: false, width: 800, height: 600 }); // Fallback dimensions
          };
          retryImage.src = img.url;
        };
        image.src = img.url;
      });
    });

    // Wait for ALL images in the batch to load
    const loadedImages = await Promise.all(imagePromises);

    console.log(
      `Batch ${currentBatch + 1}: ${loadedImages.length} images loaded`
    );

    // Add all images from batch, fill columns to target height
    if (loadedImages.length > 0) {
      // Save current scroll position
      const scrollY = window.scrollY;

      // Prevent scroll events during update
      const preventScroll = (e: Event) => {
        e.preventDefault();
        window.scrollTo(0, scrollY);
      };

      window.addEventListener("scroll", preventScroll, { passive: false });

      setColumns((prevCols) => {
        const newCols = prevCols.map((col) => [...col]);

        // Calculate heights including gaps between images (0.3em gap = ~5px approx)
        const GAP_HEIGHT = 5; // pixels
        const columnHeights = newCols.map((col) => {
          const imageHeights = col.reduce((sum, img) => {
            if (img.width && img.height && img.width > 0) {
              return sum + img.height / img.width;
            }
            return sum + 1;
          }, 0);
          // Add gap height for each image in the column
          const gapHeight = col.length * GAP_HEIGHT;
          return imageHeights + gapHeight / 100; // Normalize gaps to aspect ratio scale
        });

        // Add each image - ALWAYS to the shortest column
        loadedImages.forEach((newImage, idx) => {
          // Find the shortest column
          const shortestCol = columnHeights.indexOf(Math.min(...columnHeights));

          // Calculate the image height
          const newImageHeight =
            newImage.width && newImage.height && newImage.width > 0
              ? newImage.height / newImage.width
              : 1;

          // Log details
          const colDetails = columnHeights
            .map((h, i) => {
              const imgCount = newCols[i].length;
              return `Col${i}(${imgCount}img,${h.toFixed(1)})`;
            })
            .join(" | ");

          console.log(
            `Image ${
              currentBatch * imagesPerBatch + idx
            }: ${colDetails} => Adding to Col${shortestCol}`
          );

          newCols[shortestCol].push(newImage);
          columnHeights[shortestCol] += newImageHeight + GAP_HEIGHT / 100;
        });

        return newCols;
      });

      setDisplayedImages((prev) => [...prev, ...loadedImages]);
      setCurrentBatch((prev) => prev + 1);

      // Lock scroll position and remove event listener
      setTimeout(() => {
        window.scrollTo(0, scrollY);
        window.removeEventListener("scroll", preventScroll);

        // Final position lock after all rendering is complete
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.scrollTo(0, scrollY);
          });
        });
      }, 0);
    }

    // Wait 2 seconds before allowing next batch to load
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setBatchLoading(false);
  }, [images, currentBatch, batchLoading]);

  // Load first batch on mount
  useEffect(() => {
    if (images.length > 0 && displayedImages.length === 0) {
      loadNextBatch();
    }
  }, [images, loadNextBatch]);

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    if (
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 1000
    ) {
      loadNextBatch();
    }
  }, [loadNextBatch]);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const handleDownload = async (imageUrl: string, imageId: string) => {
    try {
      // Get bucket and key from URL path
      const path = window.location.search.substring(1);
      const [bucketName = config.defaultBucket] = path.split("/");
      const decodedBucketName = decodeURIComponent(bucketName);

      // Extract the key from the image URL (everything after the bucket name)
      const key = new URL(imageUrl).pathname.split("/").slice(2).join("/");

      // Ensure the active folder is included in the download path
      const downloadKey = activeFolder ? `${activeFolder}/${key}` : key;

      // Create download URL with query parameters
      const downloadUrl = `${
        config.apiBaseUrl
      }/download-single-image?bucketName=${encodeURIComponent(
        decodedBucketName
      )}&key=${encodeURIComponent(downloadKey)}`;

      // Create a link and trigger download
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = key.split("/").pop() || `flomingo-image-${imageId}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Failed to download image:", error);
    }
  };

  const openModal = (image: ImageData) => {
    setSelectedImage(image);
    setModalOpen(true);
    document.body.style.overflow = "hidden";
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedImage(null);
    document.body.style.overflow = "auto";
  };

  const nextImage = () => {
    if (!selectedImage) return;
    const currentIndex = displayedImages.findIndex(
      (img) => img.id === selectedImage.id
    );
    const nextIndex = (currentIndex + 1) % displayedImages.length;
    setSelectedImage(displayedImages[nextIndex]);
  };

  const prevImage = () => {
    if (!selectedImage) return;
    const currentIndex = displayedImages.findIndex(
      (img) => img.id === selectedImage.id
    );
    const prevIndex =
      currentIndex === 0 ? displayedImages.length - 1 : currentIndex - 1;
    setSelectedImage(displayedImages[prevIndex]);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!modalOpen) return;

    switch (e.key) {
      case "Escape":
        closeModal();
        break;
      case "ArrowRight":
        nextImage();
        break;
      case "ArrowLeft":
        prevImage();
        break;
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, selectedImage]);

  return (
    <div className="app-container">
      {/* S Icon */}
      {/* <div className="s-icon">
        <span>Flomingo</span>
      </div> */}

      <div className="banner">
        {bannerUrl ? (
          <>
            <img
              src={bannerUrl}
              alt="Banner"
              className="banner-image"
              // onError={(e) => {
              //   console.error("Banner image failed to load:", bannerUrl);
              //   e.currentTarget.style.display = "none";
              // }}
              // onLoad={() => console.log("Banner image loaded successfully")}
            />
          </>
        ) : (
          <div>Loading banner...</div>
        )}
      </div>

      <div className="folder-tabs">
        <div className="tabs-scroll">
          {folders.map((folder) => (
            <button
              key={folder.path}
              className={`folder-tab ${
                activeFolder === folder.path ? "active" : ""
              }`}
              onClick={() => {
                setActiveFolder(folder.path);
                updateUrlWithFolder(folder.path);
              }}
            >
              {folder.name}
            </button>
          ))}
        </div>
        <button
          className="download-album-btn"
          // title="Download Album"
          onClick={async () => {
            try {
              const path = window.location.search.substring(1);
              const [bucketName = config.defaultBucket] = path.split("/");
              const decodedBucketName = decodeURIComponent(bucketName);

              // Create download URL with query parameters
              const downloadUrl = `${
                config.apiBaseUrl
              }/download-folder-as-zip?bucketName=${encodeURIComponent(
                decodedBucketName
              )}&folderPath=${encodeURIComponent(activeFolder)}`;

              // Create a link and trigger download
              const link = document.createElement("a");
              link.href = downloadUrl;
              link.download = `${activeFolder}.zip`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            } catch (error) {
              console.error("Failed to download folder:", error);
            }
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7,10 12,15 17,10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {/* <span>Download Album</span> */}
        </button>
      </div>

      {loading && (
        <div className="loading-indicator">
          <div className="loading-spinner"></div>
        </div>
      )}

      <div className="masonry-container">
        {columns.map((column, colIndex) => (
          <div
            key={colIndex}
            className="masonry-column"
            id={`column-${colIndex}`}
          >
            {column.map((img) => (
              <div key={img.id} className="image-container">
                <img
                  src={img.url}
                  alt={`S3 Image ${img.id}`}
                  className={`masonry-img ${img.loaded ? "loaded" : ""}`}
                  loading="lazy"
                  onClick={() => openModal(img)}
                />
                <div className="image-overlay">
                  <button
                    className="download-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(img.url, img.id);
                    }}
                    title="Download image"
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7,10 12,15 17,10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {batchLoading && (
        <div className="loading-indicator">
          <div className="loading-spinner"></div>
        </div>
      )}

      {/* Gallery Modal */}
      {modalOpen && selectedImage && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>

            <button className="modal-nav modal-nav-left" onClick={prevImage}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="15,18 9,12 15,6"></polyline>
              </svg>
            </button>

            <button className="modal-nav modal-nav-right" onClick={nextImage}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="9,18 15,12 9,6"></polyline>
              </svg>
            </button>

            <div className="modal-image-container">
              <img
                src={selectedImage.url}
                alt={`Full view ${selectedImage.id}`}
                className="modal-image"
              />
            </div>

            <div className="modal-info">
              <div className="modal-counter">
                {displayedImages.findIndex(
                  (img) => img.id === selectedImage.id
                ) + 1}{" "}
                / {displayedImages.length}
              </div>
              <button
                className="modal-download"
                onClick={() =>
                  handleDownload(selectedImage.url, selectedImage.id)
                }
                title="Download image"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7,10 12,15 17,10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
