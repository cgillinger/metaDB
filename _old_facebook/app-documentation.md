# Facebook Statistics Web Application - Technical Documentation

## Application Overview

This web application analyzes and visualizes statistics from Facebook posts. It allows users to upload CSV files exported from Meta Business Suite, process the data client-side, and view statistics across different dimensions. The application is designed to run entirely in the browser without sending data to any server, prioritizing privacy and security.

### Key Features

- Import CSV data exported from Facebook/Meta Business Suite
- View statistics across three dimensions: per account, per post, and per post type
- Filter, sort, and paginate large datasets
- Customize column mappings to handle changes in Meta's export format
- Export analyzed data to CSV or Excel
- Monitor and manage memory usage to handle large datasets
- 100% client-side processing with no server requirements

## Technical Architecture

The application is built as a Single Page Application (SPA) using modern web technologies:

- **React 18**: UI framework
- **Vite**: Build system
- **TailwindCSS**: Styling
- **ShadcnUI**: Component library
- **PapaParse**: CSV parsing
- **SheetJS (XLSX)**: Excel file handling
- **localStorage & IndexedDB**: Client-side data storage

The application is designed to run in both web browsers and as an Electron desktop application. To support this dual-mode, it uses an Electron API emulator that provides compatible interfaces when running in a browser context.

## Data Flow

1. User uploads CSV files exported from Facebook/Meta Business Suite
2. CSV data is validated against configured column mappings
3. Data is processed to detect duplicates, normalize values, and calculate metrics
4. Processed data is stored in localStorage/IndexedDB
5. Data is displayed in one of three views (account, post, post type)
6. Users can filter, sort, and analyze the data
7. Users can export results to CSV or Excel

## Core Components

### Key Scripts and Their Functionality

#### `src/utils/electronApiEmulator.js`
**Purpose**: Emulates Electron's IPC API in browser context.

This module creates a browser-compatible version of Electron's API, enabling the application to run in both browser and desktop contexts without code changes. It mocks functions like `readFile`, `writeFile`, `exportToExcel`, `exportToCSV`, and `openExternalLink`.

Key functions:
- `initElectronApiEmulator()`: Initializes the emulator
- `readFile()`: Reads files from mock/localStorage
- `writeFile()`: Writes files to mock/localStorage
- `exportToExcel()`: Exports data as Excel files
- `exportToCSV()`: Exports data as CSV files

#### `src/utils/webStorageService.js`
**Purpose**: Manages all data storage operations.

This module provides comprehensive storage services using both localStorage (for small data) and IndexedDB (for larger datasets). It handles reading, writing, and clearing data, as well as managing file metadata.

Key functions:
- `saveProcessedData()`: Stores processed data
- `readColumnMappings()`: Retrieves column mappings
- `saveColumnMappings()`: Saves column mappings
- `handleFileUpload()`: Processes file uploads
- `clearAllData()`: Removes all stored data
- `getMemoryUsageStats()`: Retrieves memory usage information

#### `src/utils/webDataProcessor.js`
**Purpose**: Processes and transforms CSV data.

This module handles the core data processing logic, including parsing CSV, normalizing data, detecting duplicates, and transforming data into useful formats.

Key functions:
- `processPostData()`: Main processing function for uploaded CSV
- `analyzeCSVFile()`: Fast analysis of CSV structure
- `handleDuplicates()`: Identifies and filters duplicate posts
- `mapColumnNames()`: Applies column mappings to data

#### `src/utils/memoryUtils.js`
**Purpose**: Monitors and manages memory usage.

This module helps track browser storage limits and warns users when approaching capacity. It calculates memory usage, estimates remaining capacity, and helps prevent data loss.

Key functions:
- `calculateMemoryUsage()`: Measures current memory consumption
- `calculateMemoryWithNewFile()`: Projects memory impact of adding a file
- `estimateAdditionalFileCapacity()`: Estimates how many more files can be added

#### `src/renderer/App.jsx`
**Purpose**: Main application component.

This component initializes the application, manages global state, and handles top-level routing. It orchestrates data flow between components and manages initial data loading/clearing.

Key responsibilities:
- Clears existing data on app startup
- Checks memory usage
- Manages file uploader visibility
- Handles data processing results

#### `src/renderer/components/MainView/MainView.jsx`
**Purpose**: Central view component managing different data visualization modes.

This component allows users to switch between different analysis views (account/post/post type), select which fields to display, and manage data operations (adding more data, resetting).

Key features:
- View selection (account/post/post type)
- Field selection for display
- Memory monitoring
- Access to column mapping editor
- Data management controls

#### `src/renderer/components/FileUploader/FileUploader.jsx`
**Purpose**: Handles file selection, validation, and initial processing.

This component provides a user interface for uploading CSV files, validates file content against configured column mappings, checks memory constraints, and initiates data processing.

Key features:
- Drag-and-drop file upload
- File validation
- Column mapping validation
- Memory usage check
- Duplicate file detection

#### `src/renderer/components/AccountView/AccountView.jsx`
**Purpose**: Displays statistics aggregated by account.

This view summarizes data at the account level, showing metrics like total reach, engagement, and posts per account. It handles sorting, pagination, and export functions.

Key features:
- Aggregation by account
- Sorting on all columns
- Pagination for large datasets
- Export to CSV/Excel
- Total row calculations

#### `src/renderer/components/PostView/PostView.jsx`
**Purpose**: Displays statistics at the individual post level.

This view shows detailed metrics for each post, allows filtering by account, and provides links to original Facebook posts. It handles sorting, pagination, and export.

Key features:
- Post-level detail
- Account filtering
- Sortable columns
- Pagination
- External links to Facebook posts

#### `src/renderer/components/PostTypeView/PostTypeView.jsx`
**Purpose**: Analyzes and visualizes statistics by post type.

This view aggregates data by post type (photos, videos, links, etc.), showing metrics like average reach and engagement per type. It includes pie charts and reliability indicators.

Key features:
- Post type aggregation
- Pie chart visualization
- Statistical reliability indicators
- Filtering options
- Export functionality

#### `src/renderer/components/ColumnMappingEditor/ColumnMappingEditor.jsx`
**Purpose**: Allows customization of column mappings.

This component enables users to configure how columns in CSV files map to internal fields, accommodating changes in Facebook's export format over time.

Key features:
- Editing column mappings
- Restoring default mappings
- Providing examples for common column names
- Grouping fields by category
- Validation of mappings

#### `src/renderer/components/ColumnMappingEditor/columnMappingService.js`
**Purpose**: Provides services for column mapping logic.

This module handles the business logic for column mappings, including normalization, validation, and field value retrieval.

Key functions:
- `getCurrentMappings()`: Gets current column mappings
- `normalizeText()`: Standardizes text for comparison
- `findMatchingColumnKey()`: Matches column names
- `getValue()`: Retrieves values using mappings
- `validateRequiredColumns()`: Checks for required columns

#### `src/renderer/components/FileUploader/useColumnMapper.js`
**Purpose**: Custom React hook for column validation.

This hook validates CSV headers against configured mappings to ensure the file contains required data.

Key functions:
- `validateColumns()`: Validates CSV content
- `validateHeaders()`: Checks header structure

#### `src/renderer/components/MemoryIndicator/MemoryIndicator.jsx`
**Purpose**: Displays memory usage information.

This component shows current memory consumption, estimates remaining capacity, and alerts users when approaching storage limits.

Key features:
- Visual indicator of memory usage
- Warning thresholds
- Estimated remaining capacity
- Detailed memory breakdown

#### `src/renderer/components/LoadedFilesInfo/LoadedFilesInfo.jsx`
**Purpose**: Displays information about loaded files.

This component shows metadata about uploaded files, allowing users to manage data sources.

Key features:
- List of uploaded files
- File metadata display
- Remove individual files
- Clear all data

## Data Structure

### Column Mappings
The application uses a mapping system to translate between Facebook's CSV column names and internal field names. This allows the app to handle changes in Facebook's export format.

Key mappings include:
- Metadata fields (post_id, account_id, account_name, description, etc.)
- Metric fields (views, reach, likes, comments, shares, etc.)

### Storage Strategy
- **localStorage**: Used for configuration and small data (column mappings)
- **IndexedDB**: Used for larger datasets (post data, account data)
- Memory usage is monitored to prevent exceeding browser limits

## Extension Points

### Adding New Views
The application's tab-based interface in `MainView.jsx` can be extended with new visualization modes. Add a new tab and corresponding view component.

### Supporting New Metrics
To add support for new metrics from Facebook:
1. Add the field to relevant constant objects in `columnMappingService.js`
2. Update display names in view components
3. Update column mapping editor groups

### Adding Export Formats
The export functionality in `webStorageService.js` can be extended to support additional formats beyond CSV and Excel.

### Data Source Extensions
The application is designed for Facebook data but could be extended to support other Meta platforms (Instagram, WhatsApp) by adding appropriate column mappings and data processing logic.

## Memory Management

The application includes sophisticated memory management:
- Monitors localStorage and IndexedDB usage
- Warns users when approaching storage limits
- Provides estimates of remaining capacity
- Implements chunking strategies for large datasets
- Clearing mechanisms for data management

## Limitations

- Browser storage limits (typically 5-10MB for localStorage, ~50-200MB for IndexedDB)
- Performance degradation with very large datasets
- Dependency on Facebook's CSV export format
- Limited visualization options (currently tables and basic charts)
- No server-side processing for advanced analytics

## Conclusion

This Facebook Statistics web application provides a robust, private way to analyze Facebook post performance. It runs entirely in the browser, respecting user privacy while offering powerful analysis capabilities. The architecture balances functionality with browser limitations, using memory management strategies to handle large datasets.

For further development, key areas to consider include adding more visualization types, supporting additional data sources, implementing more advanced analytics, and optimizing memory usage for even larger datasets.